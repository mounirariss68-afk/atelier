# Riser-eval critical action coverage

The matrix in `coverage-matrix.ts` is derived from the reviewed capability
manifest. A write is high-risk when the manifest marks it irreversible or
outbound by effect class or policy class. Rows have three statuses:

- **supported** — executable and paired with a named action-level assertion
  in an existing runnable test.
- **unsupported** — the reviewed manifest says the action cannot execute
  (`unsupported` or `legacy_compat`).
- **missing** — executable high-risk action without verified test evidence.

The evidence registry is intentionally strict: a test file merely existing, a
generic confirmation/write-dispatch test, or a planned scenario does not make
an action supported. Each evidence row records the capability/tool, scenario,
owner, layer, file, and exact assertion marker; the focused test checks
that the runnable source contains both the capability tool name and marker.
Intent-smoke observations alone do not prove execution and are counted as
missing action evidence.

## Current reviewed matrix

The reviewed manifest currently yields **8 supported**, **3 unsupported**, and
**17 known missing** high-risk write actions. `coverage.test.ts` emits those
counts and fails if any executable high-risk ID appears outside the known-gap
ratchet. The existing missing IDs are tracked separately in
`KNOWN_MISSING_HIGH_RISK_IDS`; resolving one is allowed, while each new missing
ID requires an action-level test before the baseline is updated.

| Status | Capability IDs |
| --- | --- |
| Supported | `account.delete`, `codex.contract_attach_final_and_send`, `codex.contract_send_signature`, `document.email`, `ledger.approve_payroll_run`, `ledger.approve_self_billing`, `ledger.approve_send_collections`, `me.document_email` |
| Known missing | `account.profile_update_decision`, `attachment.delete_document`, `bank.recon.finalise`, `change_order.dispatch`, `change_order.record_acceptance`, `deliverable_acceptance.record_signed`, `deliverable_acceptance.submit`, `deliverable.email_send`, `meeting.cancel_internal`, `meta.undo_last_action`, `proposal.override_pricing`, `proposal.send`, `revrec_post_period`, `revrec_record_adjustment`, `wallet.dunning.send_next`, `wallet.invoice.issue`, `wallet.invoice.void` |
| Unsupported | Derived from each reviewed high-risk write whose execution status is `unsupported` or `legacy_compat`; current matrix has 3 such entries. |

## Desired action absent from the catalog

| Status | Desired action | Manifest capability/tool | Owner / next test layer |
| --- | --- | --- | --- |
| Absent (not an unsupported row) | Find and attach the current corporate tax-registration certificate for a legal entity | None; no matching capability ID or tool exists in the reviewed manifest | Finance / legal-entity workflow owner; add capability-level contract and focused integration assertion if this action is approved |

The absence above is distinct from unsupported: it is a desired action that is
not represented by a manifest entry, so it cannot appear in the derived
capability rows or be invoked through this catalog.

## Owners and layers

Evidence owners are the capability domains named in the registry: CRM,
Commercial, Delivery, Finance, Atelier document capabilities, Employee
Self-Service, and CRM Proposals. Each entry identifies the test layer actually
present: database integration, authorization, outbound contract, or named
intent-smoke observation. The known-missing actions have no asserted runnable
scenario yet; their owner/domain is evident from capability naming and should
own adding a focused scenario at the appropriate integration or policy layer.

Run the standalone check from `artifacts/api-server`:

`pnpm exec tsx ./tests/riser-eval/coverage.test.ts`

The check runs in both `test:riser-eval` and `test:riser-eval:canary`. The full
evaluation also runs `vertical-cli-action.ts` in its own scratch database:
generated PDF bytes pass through the production extractor, the resulting
owned attachment/document is persisted locally, and an HTTP chat turn selects
receipt ingestion. The probe checks preview, explicit confirmation, one
expense write, source document and audits, same-session turn and confirmation
replay, foreign/forged/cancelled confirmation denial, role-limited tool menus,
and provider failure without a second write. A deterministic local Anthropic
stub selects the tool; the probe does **not** claim to measure live-model
accuracy or shared object-storage upload. Failed assertions block the full
evaluation; successful observations are bound to the reviewed source digest
and checked by the publish canary without connecting to a database.

Tax-certificate filing is not implemented or tested as a write. It remains an
absent capability rather than an action the evaluation can report as passing.