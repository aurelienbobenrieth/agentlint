import type { AgentlintNode } from "../domain/node.js";
import { defineRule } from "../domain/rule.js";

const QUERY_CALLEES = new Set(["useQuery", "useInfiniteQuery", "queryOptions", "findMany"]);
const BOUND_KEYS = new Set(["limit", "take", "first", "pageSize", "perPage", "cursor", "offset"]);

/** Callee name of a call: `foo(...)` -> `foo`, `db.users.findMany(...)` -> `findMany`. */
function calleeName(node: AgentlintNode): string | undefined {
  const callee = node.childByFieldName("function");
  if (!callee) return undefined;
  if (callee.type === "identifier") return callee.text;
  if (callee.type === "member_expression") {
    return callee.childByFieldName("property")?.text;
  }
  return undefined;
}

/** Whether any object property inside the call's arguments uses a bound key. */
function argumentsHaveBound(node: AgentlintNode): boolean {
  const args = node.childByFieldName("arguments");
  if (!args) return false;
  return args.descendantsOfType("pair").some((pair) => BOUND_KEYS.has(pair.childByFieldName("key")?.text ?? ""));
}

export const boundedQuery = defineRule({
  id: "data/bounded-query",
  description: "Flags data queries that need explicit bounds or pagination review.",
  guidance: {
    standard:
      "Data queries that can grow with production data should include an explicit bound, cursor, or pagination contract.",
    checks: [
      "Unbounded list queries should not be introduced on hot paths.",
      "Pagination, cursors, limits, or a documented finite dataset can satisfy the standard.",
      "Tests and intentionally tiny static datasets can be accepted with a concrete reason.",
    ],
  },
  createOnce(context) {
    return {
      call_expression(node) {
        const name = calleeName(node);
        if (name === undefined || !QUERY_CALLEES.has(name)) return;
        if (argumentsHaveBound(node)) return;

        context.report({
          node,
          message: `${name}(...) has no explicit bound or pagination contract.`,
        });
      },
    };
  },
  fixtures: {
    invalid: [
      "const users = await db.users.findMany({ where: { active: true } });",
      "const query = useQuery({ queryKey: ['users'], queryFn: fetchUsers });",
    ],
    valid: [
      "const users = await db.users.findMany({ where: { active: true }, take: 50 });",
      "const query = useQuery({ queryKey: ['users'], queryFn: fetchUsers, limit: 20 });",
      // A comment mentioning a bound keyword must not suppress detection,
      // and an unrelated call must not trigger it.
      "const x = compute({ value: 1 }); // limit does not apply here",
    ],
  },
});
