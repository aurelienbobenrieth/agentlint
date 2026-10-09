/**
 * Authored Octane trees. Generated compiler code is never scanned.
 */
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { Effect, Schema } from "effect";
import type { Node, Tree } from "web-tree-sitter";
import type { AgentlintNode, Position } from "../../domain/node.js";
import { ParserError } from "../../domain/parser-error.js";
import { Parser } from "./parser.js";

const isUnknownArray = Schema.is(Schema.Array(Schema.Unknown));
const record = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));
const header = Schema.decodeUnknownSync(Schema.Struct({ type: Schema.String, start: Schema.Int, end: Schema.Int }));
const result = Schema.decodeUnknownSync(
  Schema.Struct({ sourceAst: Schema.Unknown, errors: Schema.Array(Schema.Unknown) }),
);
const ordinaryJsx = new Set([
  "JSXElement",
  "JSXFragment",
  "JSXText",
  "JSXIdentifier",
  "JSXMemberExpression",
  "JSXNamespacedName",
  "JSXOpeningElement",
  "JSXClosingElement",
  "JSXOpeningFragment",
  "JSXClosingFragment",
  "JSXAttribute",
  "JSXSpreadAttribute",
  "JSXExpressionContainer",
  "JSXEmptyExpression",
]);
const dialect = new Set(["JSXCodeBlock", "JSXIfExpression", "JSXForExpression"]);
const ignored = new Set([
  "loc",
  "start",
  "end",
  "parent",
  "path",
  "metadata",
  "comments",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "tsrx_keyword_tokens",
]);

interface AuthoredAst {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly children: ReadonlyArray<{ readonly field: string; readonly node: AuthoredAst }>;
  readonly dialect: boolean;
}

function authoredAst(value: unknown, sourceLength: number, templateBlock = false): AuthoredAst {
  const shape = header(value);
  if (shape.start < 0 || shape.end < shape.start || shape.end > sourceLength)
    throw new ParserError({
      reason: "frontend_failed",
      grammar: "octane",
      detail: `Invalid authored range for ${shape.type}`,
    });
  if (shape.type.startsWith("JSX") && !ordinaryJsx.has(shape.type) && !dialect.has(shape.type))
    throw new ParserError({
      reason: "frontend_failed",
      grammar: "octane",
      detail: `Unsupported authored syntax ${shape.type}`,
    });
  const fields = record(value);
  const boundaryContracts: Readonly<Record<string, ReadonlyArray<string>>> = {
    JSXCodeBlock: ["render"],
    JSXIfExpression: ["test", "consequent"],
    JSXForExpression: ["left", "right", "body"],
  };
  for (const field of boundaryContracts[shape.type] ?? []) header(fields[field]);
  for (const field of shape.type === "JSXCodeBlock" || shape.type === "Program" || templateBlock
    ? ["body"]
    : shape.type === "JSXElement" || shape.type === "JSXFragment"
      ? ["children"]
      : [])
    Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))(fields[field]);
  const children: Array<{ field: string; node: AuthoredAst }> = [];
  const seen = new Set<string>();
  for (const [field, entry] of Object.entries(record(value))) {
    if (ignored.has(field)) continue;
    for (const item of isUnknownArray(entry) ? entry : [entry]) {
      if (item === null || typeof item !== "object" || !("type" in item) || typeof item.type !== "string") continue;
      const child = authoredAst(item, sourceLength, dialect.has(shape.type) && item.type === "BlockStatement");
      if (child.start < shape.start || child.end > shape.end)
        throw new ParserError({
          reason: "frontend_failed",
          grammar: "octane",
          detail: `Out-of-parent authored range for ${child.type}`,
        });
      const key = `${child.type}:${child.start}:${child.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      children.push({ field, node: child });
    }
  }
  children.sort((a, b) => a.node.start - b.node.start || a.node.end - b.node.end);
  for (const [index, child] of children.entries()) {
    const previous = children[index - 1];
    if (previous && previous.node.end > child.node.start)
      throw new ParserError({
        reason: "frontend_failed",
        grammar: "octane",
        detail: `Overlapping authored ranges in ${shape.type}`,
      });
  }
  return {
    ...shape,
    children,
    dialect: templateBlock || dialect.has(shape.type) || children.some((child) => child.node.dialect),
  };
}

class AuthoredNode implements AgentlintNode {
  readonly type: string;
  get isNamed() {
    return true;
  }
  readonly children: AgentlintNode[] = [];
  parent: AgentlintNode | null;
  readonly #fields = new Map<string, AgentlintNode>();
  readonly source: string;
  readonly start: number;
  readonly end: number;
  constructor(source: string, start: number, end: number, type: string, parent: AgentlintNode | null) {
    this.source = source;
    this.start = start;
    this.end = end;
    this.type = type;
    this.parent = parent;
  }
  get text() {
    return this.source.slice(this.start, this.end);
  }
  position(offset: number): Position {
    const prefix = this.source.slice(0, offset);
    return { row: prefix.split("\n").length - 1, column: offset - (prefix.lastIndexOf("\n") + 1) };
  }
  get startPosition() {
    return this.position(this.start);
  }
  get endPosition() {
    return this.position(this.end);
  }
  get childCount() {
    return this.children.length;
  }
  add(node: AgentlintNode, field: string) {
    this.children.push(node);
    if (!this.#fields.has(field)) this.#fields.set(field, node);
  }
  childByFieldName(name: string) {
    return this.#fields.get(name) ?? null;
  }
  childrenByType(type: string) {
    return this.children.filter((child) => child.type === type);
  }
  descendantsOfType(type: string): ReadonlyArray<AgentlintNode> {
    const found: AgentlintNode[] = [];
    const pending = [...this.children].toReversed();
    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
      if (node.type === type) found.push(node);
      pending.push(...node.children.toReversed());
    }
    return found;
  }
}

class RegionNode extends AuthoredNode {
  readonly #inner: Node;
  readonly #wrap: (node: Node) => AgentlintNode;
  constructor(
    source: string,
    inner: Node,
    offset: number,
    parent: AgentlintNode | null,
    wrap: (node: Node) => AgentlintNode,
  ) {
    super(source, inner.startIndex + offset, inner.endIndex + offset, inner.type, parent);
    this.#inner = inner;
    this.#wrap = wrap;
  }
  override get isNamed() {
    return this.#inner.isNamed;
  }
  override childByFieldName(name: string) {
    const node = this.#inner.childForFieldName(name);
    return node ? this.#wrap(node) : null;
  }
}

interface OctaneRegion {
  readonly tree: Tree;
  readonly queryRoot: Node;
  readonly wrap: (node: Node) => AgentlintNode | undefined;
}
export interface OctaneSource {
  readonly root: AgentlintNode;
  readonly regions: ReadonlyArray<OctaneRegion>;
  readonly dispose: () => void;
}

/**
 * The compiler is optional and resolved from the consumer's project, never the scanner's dependencies.
 */
export const parseOctane = Effect.fn("Octane.parse")(function* ({
  source,
  file,
  anchor,
}: {
  readonly source: string;
  readonly file: string;
  readonly anchor: string;
}) {
  const parser = yield* Parser;
  const ast = yield* Effect.try({
    try: () => {
      const require = createRequire(anchor);
      const version = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.Literal("0.10.0") }))(
        require(resolve(dirname(require.resolve("octane/compiler/volar")), "../../package.json")),
      );
      const compiler: unknown = require("octane/compiler/volar");
      void version;
      const exports = record(compiler);
      const compile = exports.compileToVolarMappings;
      if (typeof compile !== "function")
        throw new ParserError({
          reason: "frontend_failed",
          grammar: "octane",
          detail: "octane/compiler/volar has no compileToVolarMappings function",
        });
      const compiled = result(Reflect.apply(compile, undefined, [source, file, { loose: false }]));
      if (compiled.errors.length > 0)
        throw new ParserError({
          reason: "frontend_failed",
          grammar: "octane",
          detail: `${file}: compiler refused source: ${compiled.errors.map(String).join("; ")}`,
        });
      const program = Schema.decodeUnknownSync(
        Schema.Struct({
          type: Schema.Literal("Program"),
          start: Schema.Literal(0),
          end: Schema.Literal(source.length),
          body: Schema.Array(Schema.Unknown),
        }),
      )(compiled.sourceAst);
      void program;
      return authoredAst(compiled.sourceAst, source.length);
    },
    catch: (cause) =>
      new ParserError({
        reason: "frontend_failed",
        grammar: "octane",
        detail: `${file}: ${cause instanceof Error ? cause.message : String(cause)}. Install a tested octane compiler in the consumer project and configure tsrx: "octane".`,
      }),
  });
  const regions: OctaneRegion[] = [];
  const dispose = () => {
    for (const region of regions) region.tree.delete();
  };
  const build: (node: AuthoredAst, parent: AgentlintNode | null) => Effect.Effect<AgentlintNode, ParserError> =
    Effect.fn("Octane.build")(function* (node, parent) {
      if (
        node.type === "JSXText" ||
        node.type === "JSXIdentifier" ||
        node.type === "JSXOpeningFragment" ||
        node.type === "JSXClosingFragment"
      )
        return new AuthoredNode(
          source,
          node.start,
          node.end,
          node.type === "JSXText"
            ? "jsx_text"
            : `octane_${node.type.replace(/^JSX/, "Jsx").replace(/[A-Z]/g, (letter, index) => `${index ? "_" : ""}${letter.toLowerCase()}`)}`,
          parent,
        );
      if (!node.dialect && node.type !== "Program") {
        const text = source.slice(node.start, node.end);
        const jsxContexts: Readonly<Record<string, readonly [string, string]>> = {
          JSXAttribute: ["<__tag ", " />"],
          JSXSpreadAttribute: ["<__tag ", " />"],
          JSXExpressionContainer: ["<>", "</>"],
        };
        const jsxContext = jsxContexts[node.type];
        const contexts: ReadonlyArray<readonly [string, string]> = jsxContext
          ? [jsxContext]
          : [
              ["", ""],
              ["(", ")"],
              ...(node.type === "Identifier"
                ? [["function __parameter(", "){}"] satisfies readonly [string, string]]
                : []),
              ...(node.type === "TSTypeAnnotation"
                ? [["const __value", "=null"] satisfies readonly [string, string]]
                : []),
            ];
        for (const [prefix, suffix] of contexts) {
          const tree = yield* parser.parse({ source: `${prefix}${text}${suffix}`, grammar: "tsx" });
          if (tree.rootNode.hasError) {
            tree.delete();
            continue;
          }
          const candidates = [tree.rootNode];
          const found: { inner: Node | undefined } = { inner: undefined };
          for (let inner = candidates.pop(); inner !== undefined; inner = candidates.pop()) {
            if (
              inner.type !== "program" &&
              inner.type !== "expression_statement" &&
              inner.startIndex === prefix.length &&
              inner.endIndex === prefix.length + text.length
            ) {
              found.inner = inner;
              break;
            }
            candidates.push(...inner.namedChildren.filter((child) => child !== null));
          }
          // Statements include their authored semicolon and must keep it in file evidence.
          found.inner ??=
            tree.rootNode.namedChildren.find(
              (child) => child !== null && child.startIndex === 0 && child.endIndex === text.length,
            ) ?? undefined;
          if (!found.inner) {
            tree.delete();
            continue;
          }
          const regionRoot = found.inner;
          const offset = node.start - prefix.length;
          const memo = new Map<number, AgentlintNode>();
          const wrap = (inner: Node): AgentlintNode => {
            const cached = memo.get(inner.id);
            if (cached) return cached;
            const owner = inner.id === regionRoot.id ? parent : inner.parent ? wrap(inner.parent) : parent;
            const wrapped = new RegionNode(source, inner, offset, owner, wrap);
            memo.set(inner.id, wrapped);
            for (const child of inner.children) if (child) wrapped.add(wrap(child), "");
            return wrapped;
          };
          const root = wrap(regionRoot);
          regions.push({ tree, queryRoot: regionRoot, wrap: (inner) => memo.get(inner.id) });
          return root;
        }
      }
      if (
        !node.dialect &&
        node.type !== "Program" &&
        ![
          "JSXOpeningElement",
          "JSXClosingElement",
          "JSXAttribute",
          "JSXExpressionContainer",
          "JSXMemberExpression",
          "JSXNamespacedName",
        ].includes(node.type)
      )
        return yield* new ParserError({
          reason: "frontend_failed",
          grammar: "octane",
          detail: `${file}: cannot parse unchanged authored ${node.type} at ${node.start}`,
        });
      const boundary = new AuthoredNode(
        source,
        node.start,
        node.end,
        node.type === "Program"
          ? "program"
          : `octane_${node.type.replace(/^JSX/, "Jsx").replace(/[A-Z]/g, (letter, index) => `${index ? "_" : ""}${letter.toLowerCase()}`)}`,
        parent,
      );
      if (node.children.length === 0 && node.type !== "Program" && node.type !== "JSXText")
        return yield* new ParserError({
          reason: "frontend_failed",
          grammar: "octane",
          detail: `${file}: cannot represent authored ${node.type} at ${node.start}`,
        });
      for (const child of node.children) boundary.add(yield* build(child.node, boundary), child.field);
      return boundary;
    });
  // Program/statement-block gaps may contain only trivia. Template gaps may contain only whitespace.
  // A complete outer range alone is not evidence that the compiler retained every authored statement.
  const validateGaps = Effect.fn("Octane.validateGaps")(function* () {
    const pending = [ast];
    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
      const statementBlock = node.type === "JSXCodeBlock" || (node.type === "BlockStatement" && node.dialect);
      const template = node.type === "JSXElement" || node.type === "JSXFragment";
      if (node.type === "Program" || statementBlock || template) {
        const opening = node.type === "JSXCodeBlock" ? "@{" : statementBlock ? "{" : "";
        const closing = statementBlock ? "}" : "";
        if (
          !source.slice(node.start, node.end).startsWith(opening) ||
          !source.slice(node.start, node.end).endsWith(closing)
        )
          return yield* new ParserError({
            reason: "frontend_failed",
            grammar: "octane",
            detail: `${file}: invalid authored block delimiters at ${node.start}`,
          });
        const gaps: string[] = [];
        let end = node.start + opening.length;
        for (const child of node.children) {
          gaps.push(source.slice(end, child.node.start));
          end = child.node.end;
        }
        gaps.push(source.slice(end, node.end - closing.length));
        for (const gap of gaps) {
          if (!gap.trim()) continue;
          if (template)
            return yield* new ParserError({
              reason: "frontend_failed",
              grammar: "octane",
              detail: `${file}: compiler omitted authored template content at ${node.start}`,
            });
          const tree = yield* parser.parse({ source: gap, grammar: "tsx" });
          const omitted =
            tree.rootNode.hasError || tree.rootNode.namedChildren.some((child) => child?.type !== "comment");
          tree.delete();
          if (omitted)
            return yield* new ParserError({
              reason: "frontend_failed",
              grammar: "octane",
              detail: `${file}: compiler omitted authored statements at ${node.start}`,
            });
        }
      }
      pending.push(...node.children.map((child) => child.node));
    }
  });
  yield* validateGaps();
  const root = yield* build(ast, null).pipe(Effect.onError(() => Effect.sync(dispose)));
  return { root, regions, dispose } satisfies OctaneSource;
});
