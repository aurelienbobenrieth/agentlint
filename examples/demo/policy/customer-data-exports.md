# Customer-data export contract

- Serve an export only to the authenticated customer or a specifically delegated operator.
- Export only profile, order-history, and invoice fields listed in the request contract.
- Never include credentials, payment tokens, internal risk scores, or support annotations.
- Record the requesting actor, customer, purpose, and selected field groups before generating the archive.
- Encrypt the archive, expire it after 24 hours, and include it in the customer's deletion workflow.
