import { defineConfig } from "@aurelienbbn/agentlint";
import { idempotentPaymentCaptureRule } from "../../payment-rule.js";

const idempotentPaymentCapture = idempotentPaymentCaptureRule({ include: "src/**/*.ts", includeReference: false });

export default defineConfig({ rules: [idempotentPaymentCapture] });
