import { BlockStack, Button, Card, CodeBlock, InlineStack, StatePill, Text, cn } from "@agentlint/ui";
import { useState } from "react";
import { useReviewAction } from "@/api";
import { actionLabel, statusLabel, statusTone } from "@/lib/labels";
import { m } from "@/messages";
import type { ReviewActionType, ReviewFindingPayload, ReviewRulePayload } from "@/types";
import { GuidancePanel } from "./guidance-panel";
import { ReasonForm } from "./reason-form";

function availableActions(finding: ReviewFindingPayload, humanRule: boolean): ReviewActionType[] {
  if (finding.status === "pending_approval") return ["approve", "request_changes"];
  if (finding.status === "unresolved") {
    return humanRule ? ["approve", "request_changes"] : ["accept", "defer", "no_fix", "request_changes"];
  }
  return ["request_changes"];
}

export function FindingCard({ finding, rule }: { finding: ReviewFindingPayload; rule: ReviewRulePayload | undefined }) {
  const action = useReviewAction();
  const [activeAction, setActiveAction] = useState<ReviewActionType | null>(null);
  const [reason, setReason] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const humanRule = rule?.resolution === "human";
  const gutter = `${String(finding.line).padStart(4)} |`;

  const startAction = (type: ReviewActionType) => {
    setActiveAction(type);
    setErrorMessage(null);
    // Approving a pending request pre-fills the agent's stated reason so the
    // human edits or confirms rather than retyping.
    setReason(
      type === "approve" && finding.disposition?.status === "approval_requested" ? finding.disposition.reason : "",
    );
  };

  const submit = () => {
    if (!activeAction) return;
    action.mutate(
      { type: activeAction, ruleId: finding.ruleId, hash: finding.hash, reason },
      {
        onSuccess: () => {
          setActiveAction(null);
          setReason("");
        },
        onError: (error) => setErrorMessage(error.message),
      },
    );
  };

  return (
    <Card
      className={cn("mb-4 gap-0 p-0", finding.status === "pending_approval" && "border-amber-500/50")}
      data-finding={finding.hash}
    >
      <InlineStack gap="sm" wrap className="border-b px-4 py-2.5">
        <StatePill tone={statusTone(finding.status)}>{statusLabel(finding.status)}</StatePill>
        {humanRule ? <StatePill tone="human">{m.pill_human_gated()}</StatePill> : null}
        {rule?.persistence === "durable" ? <StatePill tone="durable">{m.pill_durable()}</StatePill> : null}
        <Text mono size="sm" className="text-blue-600 dark:text-blue-400">
          {finding.ruleId}
        </Text>
        <Text mono tone="muted" size="xs">
          {finding.file}:{finding.line}:{finding.column}
        </Text>
        <Text mono tone="muted" size="xs" className="ml-auto">
          [{finding.hash}]
        </Text>
      </InlineStack>

      <BlockStack gap="sm" className="py-3">
        <Text weight="semibold" as="p" className="m-0 px-4">
          {finding.message}
        </Text>

        <div className="px-4">
          <CodeBlock lines={finding.context.split("\n")} isHighlighted={(line) => line.startsWith(gutter)} />
        </div>

        {rule ? <GuidancePanel rule={rule} /> : null}

        {finding.disposition ? (
          <BlockStack gap="xs" className="mx-4 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
            <Text mono tone="muted" size="xs">
              {m.disposition_by({
                status: finding.disposition.status,
                actor: finding.disposition.actor,
                at: finding.disposition.at,
              })}
            </Text>
            <Text size="sm">{finding.disposition.reason}</Text>
          </BlockStack>
        ) : null}

        {activeAction ? (
          <ReasonForm
            action={activeAction}
            reason={reason}
            onReasonChange={setReason}
            onConfirm={submit}
            onCancel={() => setActiveAction(null)}
            isPending={action.isPending}
            errorMessage={errorMessage}
          />
        ) : (
          <InlineStack gap="sm" wrap className="px-4">
            {availableActions(finding, humanRule).map((type) => (
              <Button
                key={type}
                size="sm"
                variant={type === "approve" ? "default" : type === "request_changes" ? "outline" : "secondary"}
                className={cn(
                  type === "approve" && "bg-emerald-600 text-white hover:bg-emerald-700",
                  type === "request_changes" && "border-red-500/50 text-red-600 dark:text-red-400",
                )}
                onClick={() => startAction(type)}
              >
                {actionLabel(type)}
              </Button>
            ))}
          </InlineStack>
        )}
      </BlockStack>
    </Card>
  );
}
