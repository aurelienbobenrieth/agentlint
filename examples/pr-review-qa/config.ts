import { defineConfig, defineRule } from "@aurelienbbn/agentlint";

// Disposable PR fixture. This configuration is not intended to be merged.
export default defineConfig({
  rules: [
    defineRule({
      lifecycle: "state",
      standard: {
        id: "qa/delete-customer-data",
        revision: 1,
        title: "Review before deleting customer data",
        guidance: {
          standard:
            "Before deleting customer data, a human confirms who will be affected and whether a mistake can be undone.",
          checks: [
            "Which customer's data will be deleted, and who requested it?",
            "Can the data be recovered if the wrong customer was selected?",
          ],
        },
      },
      detector: {
        id: "qa/delete-customer-data-call",
        version: 1,
        match: { pattern: "deleteCustomerData($_)", message: "This permanently deletes a customer's data." },
        fixtures: {
          mustReport: [{ file: "fixture.js", source: "deleteCustomerData(customerId)" }],
          mustStaySilent: [{ file: "fixture.js", source: "archiveCustomerData(customerId)" }],
        },
      },
      binding: { id: "qa/delete-customer-data", authority: "human", include: ["examples/pr-review-qa/*.js"] },
    }),
    defineRule({
      lifecycle: "state",
      standard: {
        id: "qa/email-all-customers",
        revision: 1,
        title: "Review before emailing every customer",
        guidance: {
          standard: "Before emailing every customer, a human reviews the message and confirms who should receive it.",
          checks: [
            "Has someone checked a preview of the actual email?",
            "Should every customer receive it, or only a smaller group?",
          ],
        },
      },
      detector: {
        id: "qa/email-all-customers-call",
        version: 1,
        match: { pattern: "emailAllCustomers($_)", message: "This sends an email to every customer." },
        fixtures: {
          mustReport: [{ file: "fixture.js", source: "emailAllCustomers(message)" }],
          mustStaySilent: [{ file: "fixture.js", source: "sendEmailPreview(message)" }],
        },
      },
      binding: { id: "qa/email-all-customers", authority: "human", include: ["examples/pr-review-qa/*.js"] },
    }),
  ],
});
