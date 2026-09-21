import { defineRule } from "@aurelienbbn/agentlint";

export const idempotentPaymentCaptureRule = ({
  include,
  includeReference,
}: {
  readonly include: string;
  readonly includeReference: boolean;
}) =>
  defineRule({
    lifecycle: "state",
    standard: {
      id: "payments/idempotent-capture",
      revision: 1,
      title: "Payment captures are safe to retry",
      guidance: {
        standard: "Every payment capture supplies a stable idempotency key derived from the business operation.",
        checks: [
          "Confirm the key is stable across retries and unique across distinct purchases.",
          "A request-scoped random value does not satisfy the standard.",
        ],
        examples: [
          {
            label: "Order identity survives retries",
            code: "payments.capture({ orderId, amount, idempotencyKey: `order:${orderId}` })",
          },
        ],
        refs: includeReference ? [{ type: "url", href: "https://docs.stripe.com/api/idempotent_requests" }] : [],
      },
    },
    detector: {
      id: "typescript/payment-capture-without-idempotency-key",
      version: 1,
      match: {
        pattern: "$CLIENT.capture($$$ARGS)",
        where: { notHas: "idempotencyKey: $_" },
        message: "Payment capture has no explicit idempotency key.",
      },
      fixtures: {
        mustReport: ["payments.capture({ orderId, amount })"],
        mustStaySilent: ["payments.capture({ orderId, amount, idempotencyKey: `order:${orderId}` })"],
      },
    },
    binding: {
      id: "payments/idempotent-capture",
      authority: "agent",
      include: [include],
    },
  });
