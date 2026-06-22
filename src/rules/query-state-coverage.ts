import { defineRule } from "../domain/rule.js";

const QUERY_HOOK_PATTERN = /\b(useQuery|useInfiniteQuery)\s*\(/;

export const queryStateCoverage = defineRule({
  id: "ui/query-state-coverage",
  description: "Flags user-facing query hooks that need UI state coverage review.",
  guidance: {
    standard:
      "User-facing queries should expose distinct loading, error, empty, and populated states. Error states should not silently render empty data.",
    checks: [
      "Loading and refetching states should be visible when they affect user action.",
      "Error states should provide recovery when retry is meaningful.",
      "Empty states should be distinct from loading and error states.",
    ],
    examples: [
      {
        label: "Missing error state",
        bad: "if (!data) return <Skeleton />;",
        good: "if (query.isError) return <ErrorState />; if (query.isPending) return <Skeleton />;",
      },
    ],
  },
  createOnce(context) {
    return {
      call_expression(node) {
        if (!QUERY_HOOK_PATTERN.test(node.text)) return;

        context.report({
          node,
          message: "Query hook should be checked for loading, error, empty, and populated UI states.",
        });
      },
    };
  },
});
