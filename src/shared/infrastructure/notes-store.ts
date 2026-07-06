/**
 * Learned-notes store.
 *
 * Notes are markdown files with optional trigger frontmatter. A rule encodes
 * a normative standard and gates completion; a note encodes a situational
 * fact and never blocks. Notes whose triggers match a scanned file are
 * surfaced as non-blocking context lines — the body stays on disk until the
 * reader opens it, keeping base context small.
 *
 * Activation is layered: deterministic triggers when the note has them,
 * plain `rg` search as the fallback for notes that cannot express one.
 *
 * @module
 * @since 0.2.0
 */

import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import picomatch from "picomatch";
import { Env } from "../../config/env.js";

export const NoteTriggers = Schema.Struct({
  /** Globs of project files this note is relevant to. */
  files: Schema.optional(Schema.Array(Schema.String)),
  /** Regex matched against a scanned file's source. */
  grep: Schema.optional(Schema.String),
});

export type NoteTriggers = Schema.Schema.Type<typeof NoteTriggers>;

export const LearnedNote = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  /** Project-relative path of the note markdown file. */
  path: Schema.String,
  triggers: NoteTriggers,
});

export type LearnedNote = Schema.Schema.Type<typeof LearnedNote>;

/**
 * A note whose triggers matched at least one scanned file.
 *
 * @since 0.2.0
 * @category models
 */
export const MatchedNote = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  path: Schema.String,
  matchedFiles: Schema.Array(Schema.String),
});

export type MatchedNote = Schema.Schema.Type<typeof MatchedNote>;

const DEFAULT_NOTE_DIRS = [".agents/learn"] as const;

interface Frontmatter {
  readonly [key: string]: string | ReadonlyArray<string> | Frontmatter;
}

/**
 * Parse the minimal flat frontmatter subset notes use: `key: value`,
 * one level of nesting via 2-space indentation, inline `[a, b]` arrays,
 * and `- item` block lists.
 */
export function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match || match[1] === undefined) return { frontmatter: {}, body: content };

  const body = content.slice(match[0].length);
  const root: Record<string, string | string[] | Record<string, string | string[]>> = {};
  let currentSection: Record<string, string | string[]> | undefined;
  let currentList: { holder: Record<string, string | string[]>; key: string } | undefined;

  const parseValue = (raw: string): string | string[] => {
    const trimmed = raw.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      return trimmed
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim().replace(/^["']|["']$/g, ""))
        .filter((item) => item.length > 0);
    }
    return trimmed.replace(/^["']|["']$/g, "");
  };

  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim().length === 0) continue;

    const listItem = line.match(/^(\s+)- (.*)$/);
    if (listItem && currentList && listItem[2] !== undefined) {
      const existing = currentList.holder[currentList.key];
      const list = Array.isArray(existing) ? existing : [];
      list.push(parseValue(listItem[2]) as string);
      currentList.holder[currentList.key] = list;
      continue;
    }

    const nested = line.match(/^ {2,}([\w-]+):\s*(.*)$/);
    if (nested && currentSection && nested[1] !== undefined) {
      const key = nested[1];
      const value = nested[2] ?? "";
      if (value.trim().length === 0) {
        currentSection[key] = [];
        currentList = { holder: currentSection, key };
      } else {
        currentSection[key] = parseValue(value);
        currentList = undefined;
      }
      continue;
    }

    const top = line.match(/^([\w-]+):\s*(.*)$/);
    if (top && top[1] !== undefined) {
      const key = top[1];
      const value = top[2] ?? "";
      if (value.trim().length === 0) {
        const section: Record<string, string | string[]> = {};
        root[key] = section;
        currentSection = section;
        currentList = { holder: root as Record<string, string | string[]>, key };
      } else {
        root[key] = parseValue(value);
        currentSection = undefined;
        currentList = undefined;
      }
    }
  }

  return { frontmatter: root as Frontmatter, body };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): ReadonlyArray<string> | undefined {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  return undefined;
}

/**
 * Evaluate which notes are relevant to the scanned files.
 *
 * A note matches when its `files` globs hit a scanned file and, if `grep`
 * is present, the regex matches that file's source. Notes without any
 * trigger never auto-surface — they stay searchable on disk.
 *
 * @since 0.2.0
 * @category execution
 */
export function matchNotes(
  notes: ReadonlyArray<LearnedNote>,
  scanned: ReadonlyArray<{ readonly file: string; readonly source: string }>,
): ReadonlyArray<MatchedNote> {
  const matched: MatchedNote[] = [];

  for (const note of notes) {
    const hasFiles = (note.triggers.files?.length ?? 0) > 0;
    const hasGrep = note.triggers.grep !== undefined && note.triggers.grep.length > 0;
    if (!hasFiles && !hasGrep) continue;

    const fileMatcher = hasFiles ? picomatch([...(note.triggers.files ?? [])]) : undefined;
    let grepRegex: RegExp | undefined;
    if (hasGrep) {
      try {
        grepRegex = new RegExp(note.triggers.grep ?? "");
      } catch {
        continue;
      }
    }

    const files = scanned
      .filter((entry) => (fileMatcher ? fileMatcher(entry.file) : true))
      .filter((entry) => (grepRegex ? grepRegex.test(entry.source) : true))
      .map((entry) => entry.file);

    if (files.length > 0) {
      matched.push({ name: note.name, description: note.description, path: note.path, matchedFiles: files });
    }
  }

  return matched;
}

export class NotesStore extends Context.Service<
  NotesStore,
  {
    /** Load all notes from the configured directories. */
    load(dirs?: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<LearnedNote>>;
  }
>()("agentlint/NotesStore") {
  static readonly layer: Layer.Layer<NotesStore, never, FileSystem.FileSystem | Path.Path | Env> = Layer.effect(
    NotesStore,
    Effect.gen(function* () {
      const env = yield* Env;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const listMarkdown = (dir: string): Effect.Effect<string[]> =>
        Effect.gen(function* () {
          const entries = yield* fs.readDirectory(dir);
          const results: string[] = [];
          for (const name of entries) {
            const fullPath = path.resolve(dir, name);
            const info = yield* fs.stat(fullPath);
            if (info.type === "Directory") {
              results.push(...(yield* listMarkdown(fullPath)));
            } else if (name.endsWith(".md") && !name.startsWith("_")) {
              results.push(fullPath);
            }
          }
          return results;
        }).pipe(Effect.catch(() => Effect.succeed([] as string[])));

      return NotesStore.of({
        load: (dirs) =>
          Effect.gen(function* () {
            const noteDirs = dirs && dirs.length > 0 ? dirs : DEFAULT_NOTE_DIRS;
            const notes: LearnedNote[] = [];

            for (const dir of noteDirs) {
              const absDir = path.resolve(env.cwd, dir);
              for (const filePath of yield* listMarkdown(absDir)) {
                const content = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""));
                if (content.length === 0) continue;

                const { frontmatter } = parseFrontmatter(content);
                const relative = path.relative(env.cwd, filePath).replace(/\\/g, "/");
                const triggersRaw = frontmatter["triggers"];
                const triggers =
                  typeof triggersRaw === "object" && triggersRaw !== null && !Array.isArray(triggersRaw)
                    ? triggersRaw
                    : {};

                notes.push({
                  name: asString(frontmatter["name"]) ?? relative.replace(/\.md$/, "").split("/").pop() ?? relative,
                  description: asString(frontmatter["description"]) ?? "",
                  path: relative,
                  triggers: {
                    files: asStringArray((triggers as Frontmatter)["files"]),
                    grep: asString((triggers as Frontmatter)["grep"]),
                  },
                });
              }
            }

            return notes as ReadonlyArray<LearnedNote>;
          }),
      });
    }),
  );
}
