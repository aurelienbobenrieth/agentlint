import { BlockStack, Button, InlineStack, Text, Textarea } from "@agentlint/ui";
import { m } from "@/paraglide/messages.js";
import { actionLabel } from "@/lib/labels";
import type { ReviewActionType } from "@/types";

interface ReasonFormProps {
  action: ReviewActionType;
  reason: string;
  onReasonChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
  errorMessage: string | null;
}

const CONFIRM_VARIANTS: Record<ReviewActionType, "primary" | "destructive" | "default"> = {
  approve: "primary",
  accept: "default",
  defer: "default",
  no_fix: "default",
  request_changes: "destructive",
};

export function ReasonForm({
  action,
  reason,
  onReasonChange,
  onConfirm,
  onCancel,
  isPending,
  errorMessage,
}: ReasonFormProps) {
  const label = actionLabel(action);
  return (
    <BlockStack gap="sm" className="px-4 pb-4">
      <Textarea
        autoFocus
        rows={3}
        placeholder={m.reason_placeholder({ action: label.toLowerCase() })}
        value={reason}
        onChange={(event) => onReasonChange(event.target.value)}
      />
      <InlineStack gap="sm">
        <Button
          variant={CONFIRM_VARIANTS[action] === "primary" ? "default" : CONFIRM_VARIANTS[action]}
          disabled={isPending || reason.trim().length === 0}
          onClick={onConfirm}
        >
          {m.action_confirm({ action: label.toLowerCase() })}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {m.action_cancel()}
        </Button>
        {errorMessage ? (
          <Text tone="danger" size="xs">
            {errorMessage}
          </Text>
        ) : null}
      </InlineStack>
    </BlockStack>
  );
}
