/**
 * Formatting-insensitive file structure: the evidence of `source-structure` v4.
 *
 * A formatter rewrites trivia that tree-sitter keeps as nodes: trailing commas, semicolons, quote style, redundant
 * parentheses, the parentheses around a lone arrow parameter, a union's leading `|`, number spelling, JSX whitespace,
 * and comment layout. Each of those is normalized here to one spelling, so formatting with oxfmt or Prettier at any
 * width leaves the structure equal, while identifiers, literal values, operators, and the tree shape stay in it.
 *
 * @module
 */

import type { AgentlintNode, Position } from "../../node.js";

/**
 * Parentheses the syntax tree makes redundant: the tree already records the grouping they spell.
 */
const PARENTHESES = new Set(["parenthesized_expression", "parenthesized_type"]);

/**
 * Types whose nested instances are one flat list: `A | (B | C)` and a leading `| A | B` are the same union.
 */
const FLATTENED = new Set(["union_type", "intersection_type"]);

/**
 * Member lists whose separators, `,` or `;`, are interchangeable.
 */
const SEPARATED = new Set(["interface_body", "object_type"]);

const CLOSERS = new Set([")", "]", "}", ">"]);

/**
 * Children that are text to a JSX element: text, and `{"literal"}` expressions a formatter adds for significant spaces.
 */
const JSX_PARENTS = new Set(["jsx_element", "jsx_fragment"]);

/**
 * A string in the key position of these parents names a property; `{ "a": 1 }` and `{ a: 1 }` are the same object.
 */
const KEY_FIELDS: Readonly<Record<string, string>> = {
  pair: "key",
  pair_pattern: "key",
  property_signature: "name",
  public_field_definition: "name",
  method_definition: "name",
  method_signature: "name",
  abstract_method_signature: "name",
};

/**
 * Text between the children of these nodes is content, whitespace included.
 */
const VERBATIM_GAPS = new Set(["template_string", "template_literal_type"]);

const IDENTIFIER_NAME = /^[A-Za-z_$][\w$]*$/;

function sameNode(left: AgentlintNode, right: AgentlintNode): boolean {
  return (
    left.type === right.type &&
    left.startPosition.row === right.startPosition.row &&
    left.startPosition.column === right.startPosition.column &&
    left.endPosition.row === right.endPosition.row &&
    left.endPosition.column === right.endPosition.column
  );
}

const significant = (node: AgentlintNode): ReadonlyArray<AgentlintNode> =>
  node.children.filter((child) => child.isNamed && child.type !== "comment");

/**
 * `(a?.b).c` stops at `.c` when `a` is nullish; `a?.b.c` does not. Parentheses around an optional chain that is itself
 * accessed or called are kept.
 */
function unwrapped(node: AgentlintNode): AgentlintNode | undefined {
  if (!PARENTHESES.has(node.type)) return undefined;
  const inner = significant(node);
  const only = inner.length === 1 ? inner[0] : undefined;
  if (!only || node.children.some((child) => child.type === "comment")) return undefined;
  const parent = node.parent;
  const accessed =
    parent !== null &&
    (parent.type === "member_expression" ||
      parent.type === "call_expression" ||
      parent.type === "subscript_expression");
  return accessed && only.text.includes("?.") ? undefined : only;
}

/**
 * The node a formatter-redundant wrapper stands for.
 */
function resolve(node: AgentlintNode): AgentlintNode {
  const inner = unwrapped(node);
  return inner ? resolve(inner) : node;
}

/**
 * A cooked JavaScript string literal body: escapes resolved, so `'it\'s'` and `"it's"` are equal.
 */
function cookString(body: string): string {
  return body.replace(
    /\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([0-7]{1,3})|(\r\n|[\n\r\u2028\u2029])|([^]))/g,
    (match, codePoint: string, unit: string, byte: string, octal: string, continuation: string, other: string) => {
      const point = codePoint ? Number.parseInt(codePoint, 16) : undefined;
      // An escape beyond Unicode is a syntax error the parser already reported; keep it as written.
      if (point !== undefined) return point <= 0x10ffff ? String.fromCodePoint(point) : match;
      if (unit) return String.fromCharCode(Number.parseInt(unit, 16));
      if (byte) return String.fromCharCode(Number.parseInt(byte, 16));
      if (octal) return String.fromCharCode(Number.parseInt(octal, 8));
      if (continuation) return "";
      const simple: Readonly<Record<string, string>> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v" };
      return other === undefined ? match : (simple[other] ?? other);
    },
  );
}

const stringBody = (node: AgentlintNode): string => node.text.slice(1, -1);

/**
 * The value of a JSX child that renders as text, per JSX whitespace rules; `undefined` for any other child.
 */
function jsxText(node: AgentlintNode): string | undefined {
  if (node.type === "jsx_text") {
    const lines = node.text.split(/\r\n|\n|\r/);
    // As Babel's cleanJSXElementLiteralChild: with no visible line, the first line counts as the last visible one.
    const lastNonEmpty = Math.max(
      0,
      lines.findLastIndex((line) => /[^ \t]/.test(line)),
    );
    return lines
      .map((line, index) => {
        const tabs = line.replace(/\t/g, " ");
        const leading = index === 0 ? tabs : tabs.replace(/^ +/, "");
        const trimmed = index === lines.length - 1 ? leading : leading.replace(/ +$/, "");
        return trimmed && index !== lastNonEmpty ? `${trimmed} ` : trimmed;
      })
      .join("");
  }
  if (node.type !== "jsx_expression" || node.children.some((child) => child.type === "comment")) return undefined;
  const inner = significant(node);
  const only = inner.length === 1 ? inner[0] : undefined;
  return only?.type === "string" ? cookString(stringBody(only)) : undefined;
}

/**
 * One normalized child: a node, or text merged from adjacent JSX text children.
 */
type Entry =
  | { readonly _tag: "Node"; readonly node: AgentlintNode; readonly raw: number }
  | {
      readonly _tag: "Text";
      readonly text: string;
      readonly nodes: ReadonlyArray<AgentlintNode>;
      readonly raw: number;
    };

/**
 * A comma before a closing bracket, a `;`, a union's `|`, and a member separator carry no meaning the tree does not.
 */
function dropped({
  parent,
  siblings,
  index,
}: {
  readonly parent: AgentlintNode;
  readonly siblings: ReadonlyArray<AgentlintNode>;
  readonly index: number;
}): boolean {
  const node = siblings[index];
  if (node === undefined || node.isNamed) return false;
  if (node.type === ";") return true;
  if (node.type === "|" && parent.type === "union_type") return true;
  if (node.type === "&" && parent.type === "intersection_type") return true;
  if (node.type !== ",") return false;
  if (SEPARATED.has(parent.type)) return true;
  // `[a, , b]` keeps its hole: only the comma right before the closing bracket goes.
  const next = siblings.slice(index + 1).find((sibling) => sibling.type !== "comment");
  return next !== undefined && next === siblings.at(-1) && CLOSERS.has(next.type);
}

function entries(node: AgentlintNode): ReadonlyArray<Entry> {
  const siblings = node.children;
  const result: Entry[] = [];
  const text: { value: string; nodes: AgentlintNode[]; raw: number } = { value: "", nodes: [], raw: -1 };
  const flush = () => {
    if (text.nodes.length > 0 && text.value !== "")
      result.push({ _tag: "Text", text: text.value, nodes: text.nodes, raw: text.raw });
    text.value = "";
    text.nodes = [];
  };
  for (const [index, child] of siblings.entries()) {
    if (dropped({ parent: node, siblings, index })) continue;
    const value = JSX_PARENTS.has(node.type) ? jsxText(child) : undefined;
    if (value !== undefined) {
      if (text.nodes.length === 0) text.raw = index;
      text.value += value;
      text.nodes.push(child);
      continue;
    }
    flush();
    // `new Foo` and `new Foo()` construct the same way.
    if (node.type === "new_expression" && child.type === "arguments" && significant(child).length === 0) continue;
    const target = resolve(child);
    if (FLATTENED.has(node.type) && target.type === node.type) {
      for (const nested of entries(target)) result.push({ ...nested, raw: index });
      continue;
    }
    result.push({ _tag: "Node", node: child, raw: index });
  }
  flush();
  return result;
}

/**
 * `(x) => x` and `x => x`: a lone, untyped, unassigned arrow parameter.
 */
function loneArrowParameter(node: AgentlintNode): string | undefined {
  if (node.type !== "formal_parameters" || node.parent?.type !== "arrow_function") return undefined;
  const parameters = significant(node);
  const only = parameters.length === 1 ? parameters[0] : undefined;
  if (only?.type !== "required_parameter" || only.children.length !== 1) return undefined;
  const name = only.children[0];
  return name?.type === "identifier" ? name.text : undefined;
}

function canonicalNumber(text: string): string {
  const plain = text.replaceAll("_", "").toLowerCase();
  // A legacy octal literal (`017`) reads differently from its decimal spelling: keep it as written.
  if (/^0\d/.test(plain)) return plain;
  if (plain.endsWith("n")) {
    try {
      return `${BigInt(plain.slice(0, -1)).toString()}n`;
    } catch {
      // REASON: an unparseable literal is kept verbatim; both sides of a comparison keep it the same way.
      return plain;
    }
  }
  const value = Number(plain);
  return Number.isFinite(value) ? String(value) : plain;
}

const collapse = (value: string): string => value.replace(/\s+/g, " ").trim();

function canonicalComment(text: string): string {
  if (text.startsWith("//")) return `//${collapse(text.slice(2))}`;
  if (!text.startsWith("/*")) return collapse(text);
  const documentation = text.startsWith("/**") && text !== "/**/";
  const body = text.slice(documentation ? 3 : 2, text.endsWith("*/") ? -2 : undefined);
  const lines = body.split(/\r\n|\n|\r/).map((line) => line.replace(/^\s*\*?/, ""));
  return `${documentation ? "/**" : "/*"}${collapse(lines.join(" "))}`;
}

/**
 * A node that normalizes to one value: `[type, value]`, or `undefined` for a node whose children carry it.
 */
function leaf(node: AgentlintNode): readonly [type: string, value: string] | undefined {
  if (node.type === "string") {
    const parent = node.parent;
    if (parent?.type === "jsx_attribute") return ["string", stringBody(node)];
    const value = cookString(stringBody(node));
    const field = parent ? KEY_FIELDS[parent.type] : undefined;
    const key = field && parent ? parent.childByFieldName(field) : null;
    if (key !== null && sameNode(key, node) && IDENTIFIER_NAME.test(value)) return ["property_identifier", value];
    return ["string", value];
  }
  if (node.type === "number") return ["number", canonicalNumber(node.text)];
  if (node.type === "comment") return ["comment", canonicalComment(node.text)];
  const parameter = loneArrowParameter(node);
  return parameter === undefined ? undefined : ["identifier", parameter];
}

function lineStarts(source: string): ReadonlyArray<number> {
  return [0, ...Array.from(source.matchAll(/\n/gu), (match) => match.index + 1)];
}

/**
 * A position in the normalized tree: the index among its parent's normalized children.
 */
interface Slot {
  readonly parent: Slot | undefined;
  readonly index: number;
}

type Pending =
  | { readonly _tag: "Node"; readonly node: AgentlintNode; readonly slot: Slot }
  | { readonly _tag: "Gap"; readonly gap: string }
  | { readonly _tag: "Text"; readonly text: string; readonly nodes: ReadonlyArray<AgentlintNode>; readonly slot: Slot };

const nodeKey = (node: AgentlintNode): string =>
  `${node.type}:${node.startPosition.row}:${node.startPosition.column}:${node.endPosition.row}:${node.endPosition.column}`;

const rawIndex = ({ parent, child }: { readonly parent: AgentlintNode; readonly child: AgentlintNode }): number =>
  parent.children.findIndex((candidate) => sameNode(candidate, child));

/**
 * A file's normalized structure, and where each of its nodes sits in it.
 */
export interface NormalizedFile {
  /**
   * Canonical evidence for the tree: a preorder list where every node contributes its type and normalized child count,
   * then a leaf its text and a normalized leaf its value. Text between children that is not whitespace (a grammar can
   * leave source outside every node) enters verbatim; inside a template it enters even when it is whitespace.
   */
  readonly structure: ReadonlyArray<string | number>;
  /**
   * Where `node` sits in `structure`, as `<type>:<i/j/k>`. A node normalization folds into a value (a string's
   * fragment, a merged JSX text's part) continues with its raw child path after `~`.
   */
  readonly occurrence: (node: AgentlintNode) => string;
}

/**
 * Normalize the tree under `root`, which must span `source`. Built without recursion, so depth costs no stack.
 */
export function normalizeFile({
  root,
  source,
}: {
  readonly root: AgentlintNode;
  readonly source: string;
}): NormalizedFile {
  const starts = lineStarts(source);
  const offset = (position: Position): number => (starts[position.row] ?? source.length) + position.column;
  const structure: Array<string | number> = [];
  const slots = new Map<string, Slot>();
  const top: Slot = { parent: undefined, index: 0 };
  const pending: Pending[] = [{ _tag: "Node", node: root, slot: top }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next._tag === "Gap") {
      structure.push(next.gap);
      continue;
    }
    if (next._tag === "Text") {
      for (const member of next.nodes) slots.set(nodeKey(member), next.slot);
      structure.push("jsx_text", 0, next.text);
      continue;
    }
    // Parentheses share their slot with what they wrap.
    for (let wrapper: AgentlintNode | undefined = next.node; wrapper; wrapper = unwrapped(wrapper))
      slots.set(nodeKey(wrapper), next.slot);
    const node = resolve(next.node);
    const value = leaf(node);
    if (value !== undefined) {
      structure.push(value[0], 0, value[1]);
      continue;
    }
    const children = node.children;
    if (children.length === 0) {
      structure.push(node.type, 0, source.slice(offset(node.startPosition), offset(node.endPosition)));
      continue;
    }
    const normalized = entries(node);
    structure.push(node.type, normalized.length);
    const verbatim = VERBATIM_GAPS.has(node.type);
    const ordered: Pending[] = [];
    const gap = (text: string) => {
      if (verbatim ? text.length > 0 : /\S/.test(text)) ordered.push({ _tag: "Gap", gap: text });
    };
    const span = { end: offset(node.startPosition) };
    for (const [index, child] of children.entries()) {
      gap(source.slice(span.end, offset(child.startPosition)));
      span.end = offset(child.endPosition);
      for (const [position, entry] of normalized.entries()) {
        if (entry.raw !== index) continue;
        const slot = { parent: next.slot, index: position };
        ordered.push(
          entry._tag === "Text"
            ? { _tag: "Text", text: entry.text, nodes: entry.nodes, slot }
            : { _tag: "Node", node: entry.node, slot },
        );
      }
    }
    gap(source.slice(span.end, offset(node.endPosition)));
    // Reversed so that gaps and children pop in source order.
    for (const item of ordered.toReversed()) pending.push(item);
  }

  const occurrence = (node: AgentlintNode): string => {
    const folded: number[] = [];
    const climb: { node: AgentlintNode; slot: Slot | undefined } = { node, slot: slots.get(nodeKey(node)) };
    while (climb.slot === undefined) {
      const parent: AgentlintNode | null = climb.node.parent;
      if (parent === null) break;
      folded.unshift(rawIndex({ parent, child: climb.node }));
      climb.node = parent;
      climb.slot = slots.get(nodeKey(parent));
    }
    const steps: number[] = [];
    for (let slot = climb.slot; slot?.parent !== undefined; slot = slot.parent) steps.unshift(slot.index);
    return `${resolve(node).type}:${steps.join("/")}${folded.length > 0 ? `~${folded.join("/")}` : ""}`;
  };
  return { structure, occurrence };
}
