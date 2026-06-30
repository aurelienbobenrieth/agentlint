import { defineRule } from "../domain/rule.js";

const QUERY_CALL_PATTERN = /\b(useQuery|useInfiniteQuery|queryOptions|findMany|select)\s*\(/;
const BOUND_PATTERN = /\b(limit|take|first|pageSize|perPage|cursor|offset)\b/;

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
        const text = node.text;
        if (!QUERY_CALL_PATTERN.test(text)) return;
        if (BOUND_PATTERN.test(text)) return;

        context.report({
          node,
          message: "Query-like call should be checked for an explicit bound or pagination contract.",
        });
      },
    };
  },
});
