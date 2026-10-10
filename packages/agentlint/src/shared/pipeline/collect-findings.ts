/**
 * Finding collection for state and change rules. @module @since 0.2.0
 */

import { Array as A, Data, Effect, Match, FileSystem, Path, Schema } from "effect";
import { DetectionError, synchronousHook, UnknownBindingError, UnparseableFilesError } from "./detection-error.js";
import { Env } from "../../config/env.js";
import { StaleScope } from "../../domain/acceptance.js";
import { compareStrings } from "../../domain/compare.js";
import { ChangeRuleContextImpl } from "../../domain/rule/change/context.js";
import { FindingRecord } from "../../domain/finding.js";
import {
  ruleMatches,
  ChangedFileDiff,
  type ChangeRule,
  type ChangeSet,
  type RuleMatch,
  type StateRule,
  type Visitors,
} from "../../domain/rule/model.js";
import { fileStructureDigest, RuleContextImpl } from "../../domain/rule/context/live.js";
import { normalizeLineEndings } from "../../domain/source-text.js";
import { ConfigLoader } from "../infrastructure/config-loader.js";
import { Git } from "../infrastructure/git/service.js";
import type { Tree } from "web-tree-sitter";
import { parseOctane, type OctaneSource } from "../infrastructure/octane.js";
import { ParserError } from "../../domain/parser-error.js";
import { Parser } from "../infrastructure/parser.js";
import {
  compileGlobs,
  explicitPathMatcher,
  FileResolverError,
  inspectRepositoryEntry,
  resolveFiles,
} from "./file-resolver.js";
import { grammarForExtension } from "./language-map.js";
import { ScanProgress } from "./scan-progress.js";
import { selectBase } from "./base.js";
import { compileMatches, disposeMatches, runMatches, type RunnableMatches } from "./pattern-match.js";
import { visitorKeys, walkFile, walkAuthoredFile } from "./tree-walker.js";
import { filterRules, scopeMatcher, sortFindings, type ScopeMatcher } from "./finding/rules.js";

export { ruleEnabledForFile } from "./finding/rules.js";

/**
 * Run one change detector against its filtered change. Every detector failure, including a broken report contract, is a
 * typed `DetectionError`.
 */
export const detectChange = ({ rule, change }: { readonly rule: ChangeRule; readonly change: ChangeSet }) =>
  Effect.try({
    try: () => {
      const context = new ChangeRuleContextImpl({ rule, change });
      synchronousHook({
        ruleId: rule.binding.id,
        hook: "detect",
        value: rule.detector.detect({ context, options: rule.binding.options }),
      });
      return context.findings;
    },
    catch: (cause) => new DetectionError({ ruleId: rule.binding.id, cause }),
  });

const CollectResult = Schema.Struct({
  findings: Schema.Array(FindingRecord),
  sources: Schema.Record(Schema.String, Schema.String),
  /**
   * The diff of every changed file a finding names, keyed by path. Empty without change rules.
   */
  changes: Schema.Record(Schema.String, ChangedFileDiff),
  scannedFiles: Schema.Array(Schema.String),
  noMatchingRules: Schema.Boolean,
  availableRules: Schema.Array(Schema.String),
  scope: Schema.Literals(["partial", "complete"]),
  stale: StaleScope,
  base: Schema.UndefinedOr(Schema.String),
});
type CollectResult = Schema.Schema.Type<typeof CollectResult>;

export const CollectOptions = Schema.Struct({
  all: Schema.Boolean,
  rules: Schema.Array(Schema.String),
  base: Schema.UndefinedOr(Schema.String),
  files: Schema.Array(Schema.String),
});
export type CollectOptions = Schema.Schema.Type<typeof CollectOptions>;

type FileTree = Data.TaggedEnum<{ Native: { readonly tree: Tree }; Octane: OctaneSource }>;
const FileTree = Data.taggedEnum<FileTree>();
const disposeFileTree = FileTree.$match({ Native: ({ tree }) => tree.delete(), Octane: ({ dispose }) => dispose() });

interface StateRuleEntry {
  readonly rule: StateRule;
  readonly inScope: ScopeMatcher;
  readonly context: RuleContextImpl;
  readonly visitors: Visitors;
  readonly keys: ReadonlyArray<string>;
  readonly matches: ReadonlyArray<RuleMatch>;
  readonly compiledByGrammar: Map<string, RunnableMatches>;
}

const readError = (file: string) => (error: { readonly message: string }) =>
  new FileResolverError({ reason: "filesystem", detail: file ? `${file}: ${error.message}` : error.message });

/**
 * What a scan read. `sources` keeps only files with a finding, so a complete scan does not hold the repository in
 * memory.
 */
export interface ScanCapture {
  readonly scanned: Set<string>;
  readonly sources: Map<string, string>;
}

export const collectStateFindings = Effect.fn("collectStateFindings")(function* (
  rules: ReadonlyArray<StateRule>,
  files: ReadonlyArray<string>,
  fixtureSources?: ReadonlyMap<string, string>,
  capture?: ScanCapture,
  tsrx?: "octane",
) {
  const env = yield* Env;
  const parser = yield* Parser;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = fixtureSources ? env.cwd : yield* fs.realPath(env.cwd).pipe(Effect.mapError(readError("")));
  const findings: FindingRecord[] = [];
  const entries: StateRuleEntry[] = [];
  const unparseable: Array<{ file: string; grammar: string }> = [];
  /**
   * Read one repository file for detection: never through a link that leaves the repository, line endings normalized
   * once.
   */
  const readSource = Effect.fn("collectStateFindings.readSource")(function* ({
    file,
    label,
  }: {
    readonly file: string;
    readonly label: string;
  }) {
    if (fixtureSources) {
      const fixture = fixtureSources.get(file);
      if (fixture === undefined)
        return yield* new FileResolverError({ reason: "filesystem", detail: `Missing fixture ${label}: ${file}` });
      return normalizeLineEndings(fixture);
    }
    const entry = yield* inspectRepositoryEntry({ fs, path, canonicalRoot: root, file }).pipe(
      Effect.mapError(readError(file)),
    );
    if (entry._tag !== "Inside")
      return yield* new FileResolverError({
        reason: "filesystem",
        detail: `${file}: ${entry._tag === "Missing" ? "no such file" : "resolves outside the repository"}`,
      });
    return normalizeLineEndings(yield* fs.readFileString(entry.realPath).pipe(Effect.mapError(readError(file))));
  });
  for (const rule of rules) {
    const dependencies: Record<string, string> = {};
    for (const dependency of rule.binding.dependencies ?? []) {
      dependencies[dependency] = yield* readSource({ file: dependency, label: "dependency" });
      capture?.sources.set(dependency, dependencies[dependency]);
    }
    const { context, visitors } = yield* Effect.try({
      // Constructing the context computes the binding digest, which can throw for a rule mutated after definition.
      try: () => {
        const created = new RuleContextImpl({ rule, dependencies });
        const hooks: Visitors =
          synchronousHook({
            ruleId: rule.binding.id,
            hook: "createOnce",
            value: rule.detector.createOnce?.({ context: created, options: rule.binding.options }),
          }) ?? {};
        return { context: created, visitors: hooks };
      },
      catch: (cause) => new DetectionError({ ruleId: rule.binding.id, cause }),
    });
    entries.push({
      rule,
      inScope: fixtureSources
        ? (file: string) => !(rule.binding.dependencies ?? []).includes(file) || scopeMatcher(rule)(file)
        : scopeMatcher(rule),
      context,
      visitors,
      keys: visitorKeys(visitors),
      matches: ruleMatches(rule),
      compiledByGrammar: new Map(),
    });
  }

  /**
   * Findings reported so far, drained or not: a file whose walk raises it produced one.
   */
  const reportedCount = () =>
    A.reduce(entries, findings.length, (total, entry) => total + entry.context.findings.length);

  const disposeCompiled = Effect.sync(() => {
    for (const entry of entries) {
      for (const compiled of entry.compiledByGrammar.values()) disposeMatches(compiled);
      entry.compiledByGrammar.clear();
    }
  });

  const walkOne = Effect.fn("collectStateFindings.walkOne")(function* ({
    file,
    absolutePath,
    source,
    grammar,
  }: {
    readonly file: string;
    readonly absolutePath: string;
    readonly source: string;
    readonly grammar: string;
  }) {
    const applicable = A.filter(entries, (entry) => entry.inScope(file));
    if (applicable.length === 0) return;
    const parsed = yield* Match.value(grammar).pipe(
      Match.when("octane", () =>
        parseOctane({ source, file, anchor: path.resolve(env.cwd, "package.json") }).pipe(Effect.map(FileTree.Octane)),
      ),
      Match.orElse((nativeGrammar) =>
        parser.parse({ source, grammar: nativeGrammar }).pipe(Effect.map((tree) => FileTree.Native({ tree }))),
      ),
    );
    if (FileTree.$match(parsed, { Native: ({ tree }) => tree.rootNode.hasError, Octane: () => false })) {
      disposeFileTree(parsed);
      unparseable.push({ file, grammar });
      return;
    }
    const runnable: Array<{ ruleId: string; context: RuleContextImpl; visitors: Visitors }> = [];
    const structureDigest = fileStructureDigest(source);
    const matchGrammar = FileTree.$match(parsed, { Native: () => grammar, Octane: () => "tsx" });

    yield* Effect.gen(function* () {
      for (const entry of applicable) {
        entry.context.setFile({ absolutePath, file, source, structureDigest });
        const enabled = yield* Effect.try({
          try: () =>
            synchronousHook({
              ruleId: entry.rule.binding.id,
              hook: "before",
              value: entry.visitors.before?.(absolutePath),
            }),
          catch: (cause) => new DetectionError({ ruleId: entry.rule.binding.id, cause }),
        });
        if (enabled === false) continue;
        if (entry.matches.length > 0) {
          const cached = entry.compiledByGrammar.get(matchGrammar);
          const compiled =
            cached ??
            (yield* Effect.gen(function* () {
              // A pattern is code in one language. It has to compile for some grammar the binding covers, not for all.
              const grammars = new Set<string>();
              for (const candidate of files) {
                const other = entry.inScope(candidate) && grammarForExtension(path.extname(candidate).slice(1));
                if (other) grammars.add(other === "octane" ? "tsx" : other);
              }
              const result = yield* compileMatches({
                ruleId: entry.rule.binding.id,
                matches: entry.matches,
                grammar: matchGrammar,
                grammars: [...grammars],
              });
              entry.compiledByGrammar.set(matchGrammar, result);
              return result;
            }));
          yield* Effect.try({
            try: () =>
              FileTree.$match(parsed, {
                Native: ({ tree }) => runMatches({ tree, runnable: compiled, context: entry.context }),
                Octane: ({ regions }) => {
                  for (const region of regions)
                    runMatches({
                      tree: region.tree,
                      queryRoot: region.queryRoot,
                      view: region.wrap,
                      runnable: compiled,
                      context: entry.context,
                    });
                },
              }),
            catch: (cause) => new DetectionError({ ruleId: entry.rule.binding.id, cause }),
          });
        }
        if (entry.keys.length > 0) {
          runnable.push({ ruleId: entry.rule.binding.id, context: entry.context, visitors: entry.visitors });
        }
      }
      findings.push(
        ...(yield* Effect.try({
          try: () =>
            FileTree.$match(parsed, {
              Native: ({ tree }) => walkFile({ tree, rules: runnable }),
              Octane: ({ root: authoredRoot }) => walkAuthoredFile({ root: authoredRoot, rules: runnable }),
            }),
          catch: (cause) =>
            cause instanceof DetectionError ? cause : new DetectionError({ ruleId: "tree-walker", cause }),
        })),
      );
    }).pipe(Effect.ensuring(Effect.sync(() => disposeFileTree(parsed))));
  });

  const progress = yield* ScanProgress;
  yield* Effect.gen(function* () {
    const walked: { last: readonly [file: string, source: string] | undefined } = { last: undefined };
    for (const file of files) {
      if (file.endsWith(".tsrx") && A.some(entries, (entry) => entry.inScope(file)) && tsrx !== "octane")
        return yield* new ParserError({
          reason: "frontend_failed",
          grammar: "octane",
          detail: `${file}: configured .tsrx state source requires tsrx: "octane" and consumer-installed octane.`,
        });
    }
    const analyzed = A.flatMap(files, (file) => {
      const grammar = grammarForExtension(path.extname(file).slice(1));
      return grammar && A.some(entries, (entry) => entry.inScope(file)) ? [{ file, grammar }] : [];
    });
    progress.analyzing(analyzed.length);
    for (const { file, grammar } of analyzed) {
      const absolutePath = fixtureSources ? file : path.resolve(env.cwd, file);
      const source = yield* readSource({ file, label: "file" });
      capture?.scanned.add(file);
      const reportedBefore = reportedCount();
      yield* walkOne({ file, absolutePath, source, grammar });
      if (reportedCount() > reportedBefore) capture?.sources.set(file, source);
      walked.last = [file, source];
      progress.analyzed();
    }
    if (unparseable.length > 0)
      return yield* new UnparseableFilesError({
        reason: "parse_failed",
        files: unparseable.toSorted((left, right) => compareStrings({ left: left.file, right: right.file })),
      });
    // An `after` hook reports against the last file walked.
    const reportedBeforeAfter = reportedCount();
    for (const entry of entries) {
      yield* Effect.try({
        try: () => synchronousHook({ ruleId: entry.rule.binding.id, hook: "after", value: entry.visitors.after?.() }),
        catch: (cause) => new DetectionError({ ruleId: entry.rule.binding.id, cause }),
      });
      findings.push(...entry.context.drainFindings());
    }
    if (walked.last && reportedCount() > reportedBeforeAfter) capture?.sources.set(...walked.last);
    return undefined;
  }).pipe(Effect.ensuring(disposeCompiled));

  return findings;
});

export const collectFindings = Effect.fn("collectFindings")(function* (options: CollectOptions) {
  const configLoader = yield* ConfigLoader;
  const env = yield* Env;
  const git = yield* Git;
  const path = yield* Path.Path;
  const config = yield* configLoader.load();
  const availableRules = config.rules
    .map((rule) => rule.binding.id)
    .toSorted((left, right) => compareStrings({ left, right }));
  for (const requested of options.rules) {
    if (!config.rulesById.has(requested))
      return yield* new UnknownBindingError({ bindingId: requested, available: availableRules });
  }
  const activeRules = filterRules({ config, requested: options.rules });
  const scope: CollectResult["scope"] =
    options.all && options.files.length === 0 && options.rules.length === 0 ? "complete" : "partial";
  const requestedBase = (yield* selectBase(options.base))?.ref;

  if (activeRules.length === 0) {
    return {
      findings: [],
      sources: {},
      changes: {},
      scannedFiles: [],
      noMatchingRules: true,
      availableRules,
      scope,
      stale: "none" as const,
      base: requestedBase,
    };
  }

  const stateRules = activeRules.filter((rule): rule is StateRule => rule.lifecycle === "state");
  const changeRules = activeRules.filter((rule): rule is ChangeRule => rule.lifecycle === "change");
  const findings: FindingRecord[] = [];
  const capture: ScanCapture = { scanned: new Set(), sources: new Map() };
  const diffs = new Map<string, ChangedFileDiff>();
  const changedPaths = yield* Effect.cached(git.changedFiles(requestedBase));

  if (stateRules.length > 0) {
    const repositoryScan = stateRules.some(
      (rule) =>
        rule.binding.dependencies?.length ||
        rule.detector.scan === "repository" ||
        (rule.detector.createOnce && rule.detector.scan !== "file"),
    );
    const files = yield* resolveFiles({
      options: {
        all: options.all || repositoryScan,
        baseRef: requestedBase,
        configIgnores: config.ignores.length ? [...config.ignores] : undefined,
        positionalFiles: !repositoryScan && options.files.length ? [...options.files] : undefined,
      },
      gitService: { changedFiles: () => changedPaths, listFiles: git.listFiles },
    });
    findings.push(...(yield* collectStateFindings(stateRules, files, undefined, capture, config.tsrx)));
  }

  const resultState = { selectedBase: requestedBase, seesEveryChange: true };
  if (changeRules.length > 0) {
    const explicitMatcher = options.files.length
      ? yield* Effect.try({
          try: () => explicitPathMatcher({ files: options.files, cwd: env.cwd, path }),
          catch: (error) =>
            error instanceof FileResolverError
              ? error
              : new FileResolverError({ reason: "filesystem", detail: String(error) }),
        })
      : undefined;
    const ignoreMatcher = compileGlobs(config.ignores);
    const scoped = changeRules.map((rule) => [rule, scopeMatcher(rule)] as const);
    const selected = (file: string) => !ignoreMatcher?.(file) && (!explicitMatcher || explicitMatcher(file));
    // Git reads and diffs only what some change rule can see: an ignored file is never loaded.
    (yield* ScanProgress).comparing();
    const change = yield* git.changeSet({
      ...(requestedBase ? { baseRef: requestedBase } : {}),
      include: (file) => selected(file) && scoped.some(([, inScope]) => inScope(file)),
    });
    resultState.selectedBase = change.baseline.ref;
    // A change finding exists only against a merge base, and only the default branch's decides which change records
    // are stale. Another merge base, or a default branch Git cannot resolve, proves nothing about them.
    if (scope === "complete" && requestedBase !== undefined) {
      const defaultBaseline = yield* git.baseline().pipe(Effect.orElseSucceed(() => undefined));
      resultState.seesEveryChange = defaultBaseline !== undefined && defaultBaseline.commit === change.baseline.commit;
    }

    for (const [rule, inScope] of scoped) {
      const filteredChange = {
        ...change,
        files: change.files.filter((file) => inScope(file.path) && selected(file.path)),
      };
      if (filteredChange.files.length === 0) continue;
      for (const file of filteredChange.files) {
        capture.scanned.add(file.path);
        capture.sources.set(file.path, file.after?.content ?? file.before?.content ?? "");
        diffs.set(file.path, {
          status: file.status,
          ...(file.previousPath ? { previousPath: file.previousPath } : {}),
          hunks: file.hunks,
        });
      }
      findings.push(...(yield* detectChange({ rule, change: filteredChange })));
    }
  }

  const stale: StaleScope = scope === "partial" ? "none" : resultState.seesEveryChange ? "all" : "state";
  const named = [...new Set(findings.flatMap((finding) => [finding.file, ...(finding.relatedFiles ?? [])]))];
  return {
    findings: sortFindings(findings),
    scannedFiles: [...capture.scanned].toSorted((left, right) => compareStrings({ left, right })),
    sources: Object.fromEntries(A.map(named, (file) => [file, capture.sources.get(file) ?? ""])),
    changes: Object.fromEntries(
      A.flatMap(named, (file) => {
        const diff = diffs.get(file);
        return diff ? [[file, diff] as const] : [];
      }),
    ),
    noMatchingRules: false,
    availableRules: activeRules
      .map((rule) => rule.binding.id)
      .toSorted((left, right) => compareStrings({ left, right })),
    scope,
    stale,
    base: resultState.selectedBase,
  };
});
