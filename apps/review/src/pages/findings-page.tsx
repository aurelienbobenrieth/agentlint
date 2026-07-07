import {
  Badge,
  BlockStack,
  Checkbox,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  PageSection,
  Spinner,
  Text,
  cn,
} from "@agentlint/ui";
import { useMemo, useState } from "react";
import { useReviewState } from "@/api";
import { FindingCard } from "@/components/finding-card";
import { m } from "@/messages";
import type { FindingStatus, ReviewFindingPayload } from "@/types";

type Filter = "needs_action" | "pending_approval" | "unresolved" | "resolved" | "all";

const RESOLVED_STATUSES: ReadonlySet<FindingStatus> = new Set(["accepted", "approved", "deferred", "no_fix"]);

function matchesFilter(finding: ReviewFindingPayload, filter: Filter): boolean {
  switch (filter) {
    case "needs_action":
      return finding.status === "pending_approval" || finding.status === "unresolved";
    case "pending_approval":
      return finding.status === "pending_approval";
    case "unresolved":
      return finding.status === "unresolved";
    case "resolved":
      return RESOLVED_STATUSES.has(finding.status);
    case "all":
      return true;
  }
}

function filterLabel(filter: Filter): string {
  switch (filter) {
    case "needs_action":
      return m.filter_needs_action();
    case "pending_approval":
      return m.filter_pending_approval();
    case "unresolved":
      return m.filter_unresolved();
    case "resolved":
      return m.filter_resolved();
    case "all":
      return m.filter_all();
  }
}

const FILTERS: ReadonlyArray<Filter> = ["needs_action", "pending_approval", "unresolved", "resolved", "all"];

export function FindingsPage() {
  const { data, isLoading, error } = useReviewState();
  const [filter, setFilter] = useState<Filter>("needs_action");
  const [hiddenRules, setHiddenRules] = useState<ReadonlySet<string>>(new Set());

  const counts = useMemo(() => {
    const result = new Map<Filter, number>();
    for (const item of FILTERS) {
      result.set(item, data?.findings.filter((finding) => matchesFilter(finding, item)).length ?? 0);
    }
    return result;
  }, [data]);

  const ruleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const finding of data?.findings ?? []) ids.add(finding.ruleId);
    return [...ids].toSorted();
  }, [data]);

  if (isLoading) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMediaFallback />
          <EmptyTitle>{m.loading_state()}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }
  if (error || !data) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{m.load_failed()}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  const visible = data.findings.filter((finding) => matchesFilter(finding, filter) && !hiddenRules.has(finding.ruleId));

  return (
    <div className="grid min-h-[calc(100vh-53px)] grid-cols-[260px_1fr]">
      <aside className="border-r bg-sidebar px-4 py-5">
        <BlockStack gap="xs">
          <Text tone="muted" size="xs" weight="semibold" className="uppercase tracking-wider">
            {m.sidebar_status()}
          </Text>
          {FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
                filter === item && "bg-accent font-semibold text-foreground",
              )}
            >
              <span>{filterLabel(item)}</span>
              <Badge
                variant={item === "pending_approval" ? "warning" : "secondary"}
                className="px-1.5 py-px text-[10px]"
              >
                {counts.get(item) ?? 0}
              </Badge>
            </button>
          ))}
        </BlockStack>

        <BlockStack gap="xs" className="mt-6">
          <Text tone="muted" size="xs" weight="semibold" className="uppercase tracking-wider">
            {m.sidebar_rules()}
          </Text>
          {ruleIds.map((ruleId) => (
            <label
              key={ruleId}
              className="flex cursor-pointer items-center gap-2 break-all rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              <Checkbox
                checked={!hiddenRules.has(ruleId)}
                onCheckedChange={(checked) => {
                  const next = new Set(hiddenRules);
                  if (checked) next.delete(ruleId);
                  else next.add(ruleId);
                  setHiddenRules(next);
                }}
              />
              <span>{ruleId}</span>
            </label>
          ))}
        </BlockStack>

        {data.staleCount > 0 ? (
          <BlockStack gap="xs" className="mt-6">
            <Text tone="muted" size="xs" weight="semibold" className="uppercase tracking-wider">
              {m.sidebar_housekeeping()}
            </Text>
            <Text tone="muted" size="xs" className="px-2">
              {m.stale_records({ count: data.staleCount })}
            </Text>
          </BlockStack>
        ) : null}
      </aside>

      <PageSection>
        {visible.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{filter === "needs_action" ? m.empty_needs_action() : m.empty_no_match()}</EmptyTitle>
              <EmptyDescription>{filter === "needs_action" ? "🎉" : ""}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          visible.map((finding) => {
            const rule = data.rules.find((candidate) => candidate.id === finding.ruleId);
            return <FindingCard key={`${finding.ruleId}:${finding.hash}`} finding={finding} rule={rule} />;
          })
        )}
      </PageSection>
    </div>
  );
}

function EmptyMediaFallback() {
  return (
    <div className="flex justify-center py-2">
      <Spinner />
    </div>
  );
}
