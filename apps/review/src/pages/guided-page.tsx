import {
  BlockStack,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  InlineStack,
  Kbd,
  StatePill,
  Text,
  cn,
} from "@agentlint/ui";
import { Button } from "@agentlint/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useReviewState } from "@/api";
import { FindingCard } from "@/components/finding-card";
import { statusLabel, statusTone } from "@/lib/labels";
import { m } from "@/messages";
import type { ReviewFindingPayload, ReviewStatePayload } from "@/types";

type QueueSection = "blocking" | "audit" | "other";

interface QueueItem {
  readonly key: string;
  readonly finding: ReviewFindingPayload;
  readonly section: QueueSection;
  readonly why: string;
}

type QueueSeed = Omit<QueueItem, "finding">;

/**
 * Order the review queue by where human attention matters most
 * (plannotator-style guided review):
 *
 * 1. pending approvals - the agent is waiting on you, CI is blocked;
 * 2. unresolved human-gated findings - nobody else can decide;
 * 3. new agent dispositions since base - the self-acceptance audit surface;
 * 4. remaining unresolved findings - agent-resolvable, weigh in if you want.
 */
function buildQueue(state: ReviewStatePayload): QueueItem[] {
  const humanGated = new Set(state.rules.filter((rule) => rule.resolution === "human").map((rule) => rule.id));
  const items: (QueueItem & { readonly priority: number })[] = [];

  for (const finding of state.findings) {
    const key = `${finding.ruleId}:${finding.hash}`;
    if (finding.status === "pending_approval") {
      items.push({ key, finding, section: "blocking", why: m.guided_why_pending(), priority: 0 });
    } else if (finding.status === "unresolved" && humanGated.has(finding.ruleId)) {
      items.push({ key, finding, section: "blocking", why: m.guided_why_human_gate(), priority: 1 });
    } else if (finding.disposition?.isNew && finding.disposition.actor.startsWith("agent:")) {
      items.push({
        key,
        finding,
        section: "audit",
        why: m.guided_why_audit({ status: finding.disposition.status, actor: finding.disposition.actor }),
        priority: 2,
      });
    } else if (finding.status === "unresolved") {
      items.push({ key, finding, section: "other", why: m.guided_why_unresolved(), priority: 3 });
    }
  }

  return items.toSorted((a, b) => a.priority - b.priority || a.finding.file.localeCompare(b.finding.file));
}

const SECTION_LABELS: Record<QueueSection, () => string> = {
  blocking: () => m.guided_section_blocking(),
  audit: () => m.guided_section_audit(),
  other: () => m.guided_section_other(),
};

/** Fingerprint of a finding's resolution state, used to detect handled items. */
function stateFingerprint(finding: ReviewFindingPayload): string {
  return `${finding.status}:${finding.disposition?.at ?? ""}`;
}

export function GuidedPage() {
  const { data, isLoading, error } = useReviewState();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [manuallyReviewed, setManuallyReviewed] = useState<ReadonlySet<string>>(new Set());
  const [queueSeed, setQueueSeed] = useState<ReadonlyArray<QueueSeed> | null>(null);
  // Fingerprints at first load: an item whose resolution state changed during
  // this session was handled through an action, no manual mark needed.
  const initialFingerprints = useRef<Map<string, string> | null>(null);
  const restoredProgressKey = useRef<string | null>(null);

  const liveQueue = useMemo(() => (data ? buildQueue(data) : []), [data]);
  const progressKey = data ? `agentlint:review-progress:${data.project}:${data.base}` : null;

  useEffect(() => {
    if (!progressKey || restoredProgressKey.current === progressKey) return;
    restoredProgressKey.current = progressKey;
    try {
      const saved = new URLSearchParams(localStorage.getItem(progressKey) ?? "");
      const savedSelectedKey = saved.get("selected");
      const savedQueue = saved
        .getAll("queue")
        .map((value): QueueSeed | null => {
          const item = new URLSearchParams(value);
          const key = item.get("key");
          const section = item.get("section") as QueueSection | null;
          const why = item.get("why");
          return key && section && why ? { key, section, why } : null;
        })
        .filter((item): item is QueueSeed => item !== null);
      if (savedSelectedKey) setSelectedKey(savedSelectedKey);
      setManuallyReviewed(new Set(saved.getAll("reviewed")));
      setQueueSeed(
        savedQueue.length > 0 ? savedQueue : liveQueue.map(({ key, section, why }) => ({ key, section, why })),
      );
    } catch {
      // Review progress is optional and may be unavailable in private browsing.
    }
  }, [liveQueue, progressKey]);

  useEffect(() => {
    if (!progressKey || restoredProgressKey.current !== progressKey) return;
    try {
      const saved = new URLSearchParams();
      if (selectedKey) saved.set("selected", selectedKey);
      for (const key of manuallyReviewed) saved.append("reviewed", key);
      for (const item of queueSeed ?? []) {
        saved.append("queue", new URLSearchParams(item).toString());
      }
      localStorage.setItem(progressKey, saved.toString());
    } catch {
      // Server-side actions remain durable even when browser storage is unavailable.
    }
  }, [manuallyReviewed, progressKey, queueSeed, selectedKey]);

  const findingsByKey = useMemo(
    () =>
      new Map<string, ReviewFindingPayload>(
        (data?.findings ?? []).map((finding) => [`${finding.ruleId}:${finding.hash}`, finding]),
      ),
    [data],
  );
  const queue = (queueSeed ?? liveQueue)
    .map((seed) => {
      const finding = findingsByKey.get(seed.key);
      return finding ? { ...seed, finding } : null;
    })
    .filter((item): item is QueueItem => item !== null);
  const liveQueueKeys = new Set(liveQueue.map((item) => item.key));

  if (data && initialFingerprints.current === null) {
    initialFingerprints.current = new Map(queue.map((item) => [item.key, stateFingerprint(item.finding)]));
  }

  const isReviewed = (item: QueueItem): boolean => {
    if (manuallyReviewed.has(item.key)) return true;
    if (!liveQueueKeys.has(item.key)) return true;
    const initial = initialFingerprints.current?.get(item.key);
    return initial !== undefined && initial !== stateFingerprint(item.finding);
  };

  const reviewedCount = queue.filter((item) => isReviewed(item)).length;
  const selected =
    queue.find((item) => item.key === selectedKey) ?? queue.find((item) => !isReviewed(item)) ?? queue[0];

  // j/k keyboard navigation over the queue.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
      if (event.key !== "j" && event.key !== "k") return;
      const index = queue.findIndex((item) => item.key === selected?.key);
      const next = event.key === "j" ? Math.min(queue.length - 1, index + 1) : Math.max(0, index - 1);
      const target = queue[next];
      if (target) setSelectedKey(target.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [queue, selected]);

  if (isLoading) {
    return (
      <Empty>
        <EmptyHeader>
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

  if (queue.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{m.guided_all_done()}</EmptyTitle>
          <EmptyDescription>{m.guided_all_done_hint()}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const rule = selected ? data.rules.find((candidate) => candidate.id === selected.finding.ruleId) : undefined;
  let lastSection: QueueSection | null = null;

  return (
    <div className="grid min-h-[calc(100vh-53px)] grid-cols-[320px_1fr]">
      <aside className="border-r bg-sidebar">
        <BlockStack gap="xs" className="border-b px-4 py-3">
          <InlineStack justify="between">
            <Text size="xs" weight="semibold" tone="muted" className="uppercase tracking-wider">
              {m.guided_queue()}
            </Text>
            <Text mono size="xs" tone="muted">
              {m.guided_progress({ done: reviewedCount, total: queue.length })}
            </Text>
          </InlineStack>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${queue.length === 0 ? 0 : Math.round((reviewedCount / queue.length) * 100)}%` }}
            />
          </div>
          <Text size="xs" tone="muted">
            <Kbd>j</Kbd> / <Kbd>k</Kbd> {m.guided_kbd_hint().replace("j / k ", "")}
          </Text>
        </BlockStack>

        <BlockStack gap="none" className="px-2 py-2">
          {queue.map((item) => {
            const sectionHeader =
              item.section !== lastSection ? (
                <Text
                  key={`section-${item.section}`}
                  size="xs"
                  weight="semibold"
                  tone="muted"
                  as="div"
                  className="px-2 pb-1 pt-3 uppercase tracking-wider first:pt-1"
                >
                  {SECTION_LABELS[item.section]()}
                </Text>
              ) : null;
            lastSection = item.section;
            const reviewed = isReviewed(item);
            return (
              <div key={item.key}>
                {sectionHeader}
                <button
                  type="button"
                  onClick={() => setSelectedKey(item.key)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent",
                    selected?.key === item.key && "bg-accent",
                    reviewed && "opacity-55",
                  )}
                >
                  <InlineStack gap="xs">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        item.section === "blocking" && !reviewed && "bg-amber-500",
                        item.section === "audit" && !reviewed && "bg-blue-500",
                        item.section === "other" && !reviewed && "bg-muted-foreground/50",
                        reviewed && "bg-emerald-500",
                      )}
                    />
                    <Text mono size="xs" className="truncate text-blue-600 dark:text-blue-400">
                      {item.finding.ruleId}
                    </Text>
                    {reviewed ? (
                      <Text size="xs" tone="muted" className="ml-auto shrink-0">
                        ✓
                      </Text>
                    ) : null}
                  </InlineStack>
                  <Text mono size="xs" tone="muted" className="truncate pl-3.5">
                    {item.finding.file}:{item.finding.line}
                  </Text>
                </button>
              </div>
            );
          })}
        </BlockStack>
      </aside>

      <main className="mx-auto w-full max-w-4xl px-6 py-6 pb-24">
        {selected ? (
          <BlockStack gap="sm">
            <InlineStack gap="sm" wrap className="rounded-lg border border-dashed px-4 py-2.5">
              <StatePill tone={selected.section === "blocking" ? "pending" : statusTone(selected.finding.status)}>
                {statusLabel(selected.finding.status)}
              </StatePill>
              <Text size="sm" tone="muted">
                {selected.why}
              </Text>
              <span className="ml-auto">
                {isReviewed(selected) ? (
                  <Text size="xs" className="text-emerald-600 dark:text-emerald-400">
                    ✓ {m.guided_reviewed()}
                  </Text>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setManuallyReviewed(new Set([...manuallyReviewed, selected.key]))}
                  >
                    {m.guided_mark_reviewed()}
                  </Button>
                )}
              </span>
            </InlineStack>
            <FindingCard finding={selected.finding} rule={rule} />
          </BlockStack>
        ) : null}
      </main>
    </div>
  );
}
