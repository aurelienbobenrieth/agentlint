import { defineRule } from "../domain/rule.js";

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
  match: [
    {
      pattern: "useQuery($$$ARGS)",
      message: "useQuery result should be checked for loading, error, empty, and populated UI states.",
    },
    {
      pattern: "useInfiniteQuery($$$ARGS)",
      message: "useInfiniteQuery result should be checked for loading, error, empty, and populated UI states.",
    },
  ],
  fixtures: {
    invalid: [
      "const query = useQuery({ queryKey: ['users'], queryFn: fetchUsers });",
      "const pages = useInfiniteQuery({ queryKey: ['feed'], queryFn: fetchFeed });",
    ],
    valid: [
      // Different callee: must not fire on look-alike identifiers.
      "const query = useQueryClient();",
      // Nested inside another call: only the inner useQuery node fires, so a
      // wrapper call alone produces nothing.
      "const helper = describe('useQuery(...) in a string', () => {});",
    ],
  },
});
