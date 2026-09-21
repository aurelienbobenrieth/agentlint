import { defineConfig, defineRule } from "@aurelienbbn/agentlint";

const idempotentPaymentCapture = defineRule({
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
    include: ["src/**/*.ts"],
  },
});

export default defineConfig({ rules: [idempotentPaymentCapture] });
