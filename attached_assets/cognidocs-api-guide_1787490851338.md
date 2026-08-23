# CogniDocs API Connection Guide

CogniDocs is an API-first document parsing service. External systems integrate
through the canonical HTTP API described here; there is no required upload step
in the web console. The API parses **invoices**, **receipts**, **bank
statements**, and **credit-card statements** into a canonical JSON envelope.

- **Base URL (development):** `https://<your-repl-domain>/api`
- **Contract:** `lib/api-spec/openapi.yaml` (OpenAPI 3.1)
- **Generated consumers:** Zod validators and a typed React client are generated
  from that contract.
- **Downloads:** authenticated Pro/Enterprise users and platform admins can
  download the authoritative files from `GET /docs/openapi.yaml` and
  `GET /docs/api-guide`.
- **Content types:** `multipart/form-data` (recommended) or `application/json`
  with base64 file content for ingestion; JSON everywhere else.

---

## 1. Authentication and access

External integrations should use a user-owned API key:

```http
X-API-Key: <your key>
```

`Authorization: Bearer <your key>` is also accepted for compatibility with the
generated browser client. It carries the same API key, role, environment, and
plan entitlements; it is not a separate OAuth token.

The web console can instead authenticate with the signed `cognidocs_session`
browser cookie. Most product routes accept either a browser session or an API
key. Account, profile, password, and 2FA operations are **session-only**.
Registration, verification, login, logout, password reset, and `GET /healthz`
are public. Admin and super-admin operations accept the documented
session/API-key alternatives and also check the owning user's current role.

When a request carries both a valid browser session and an explicit API key,
the session identifies the user and the key supplies environment/provenance.
The key must be active, belong to that same user, and satisfy current plan
entitlements. An explicitly supplied invalid or foreign key rejects the request;
CogniDocs never silently ignores it in favor of the session. If both API-key
headers are present, `X-API-Key` takes precedence over `Authorization: Bearer`.

The OpenAPI contract records the effective access class for every operation in
`x-operation-access`.

### 1.1 Required legal-policy acceptance

Every product operation authenticated by a browser session or API key also
requires the owning user to have accepted the current Terms and acknowledged
the current Privacy Policy. This is enforced after authentication, so it does
not weaken credential, role, plan, or tenant checks.

- `GET /auth/legal-requirements` is public and returns the server-owned current
  `termsVersion` and `privacyPolicyVersion`. Clients must not embed these
  versions.
- `GET /auth/me` is session-only and returns `legalAcceptance`, including the
  required versions, the latest acceptance evidence, and `isCurrent`.
- `POST /auth/legal-acceptance` is session-only. It accepts both required
  acknowledgements and the exact current versions, then appends evidence using
  the server timestamp. Existing evidence is never changed; an exact retry is
  idempotent.
- When acceptance is missing or stale, authenticated product calls—including
  calls made with an API key—return:

  ```json
  {
    "error": "Accept the current Terms and acknowledge the current Privacy Policy before continuing.",
    "code": "LEGAL_ACCEPTANCE_REQUIRED",
    "requirements": {
      "termsVersion": "current-server-value",
      "privacyPolicyVersion": "current-server-value"
    }
  }
  ```

  The HTTP status is `403`. Do not retry the product request unchanged. A human
  user must sign in, review the policies, and use the session-only acceptance
  endpoint first.
- Sign-in, sign-out, current-user discovery, policy review/acceptance, password
  reset/change, and 2FA operations remain available while acceptance is stale
  so the user can recover or secure the account.

### 1.2 API key lifecycle

- CogniDocs never creates or logs a default API key at startup. Sign in to the
  console and explicitly create a key for each integration.
- `GET /api-keys` lists the caller's keys; tokens are never returned.
- `POST /api-keys`
  `{ "name": "erp-integration", "environment": "live" }` creates a key. The
  plaintext `token` is returned **only in this response**. `environment` is
  `live` (default) or `sandbox`.
- `DELETE /api-keys/{id}` revokes an owned key immediately.
- Requests without usable credentials return `401 { "error": "..." }`.
  Revoked keys and keys whose owner is suspended stop authenticating
  immediately.
- A valid key can return `403` after a plan downgrade if its owner no longer has
  API access, or if a sandbox key is no longer included in the current plan.

### 1.3 Plans, quotas, and sandbox

Current limits are shown on the console's **Billing** page and through
`GET /billing`.

- **Monthly live documents:** accepted live documents count in the current UTC
  calendar month. Plans without an overage rate reject the next submission with
  `403`. Plans with a configured overage rate continue accepting live documents
  and expose accrued overage in `GET /billing`.
- **API key limit:** plans cap active keys. Revoke an unused key to free a slot.
- **Sandbox (Pro+):** sandbox-key jobs have `sandbox: true`, do not count toward
  the live quota or platform analytics, and have a separate hard monthly cap.
  Sandbox submissions return `403` when that cap is exhausted, even if the plan
  permits live overage.
- **Free trial:** browser upload is available, but API key access is not.

---

## 2. Money and data conventions

| Convention | Rule |
|---|---|
| **Money** | Every monetary field is an integer named `*Amount10k` or `*10k`, equal to the value × 10,000. AED 12.34 is `123400`. No floats. |
| **Quantities** | `quantity10k` uses the same ×10,000 scale. |
| **Dates** | Calendar dates are `YYYY-MM-DD`; timestamps are ISO 8601 with timezone. |
| **Statement direction** | Always use `direction` (`debit` or `credit`) for money-out versus money-in. Bank debits normally have negative `amount10k`. Credit-card purchases are `direction: "debit"` with positive `amount10k`; card payments and refunds are `direction: "credit"` with negative `amount10k`. Never infer direction from sign alone across statement types. |
| **Errors** | Ordinary non-2xx API responses return `{ "error": "message" }`. The service fails loudly and never silently fabricates or corrects parsed data. |
| **Lists** | Most catalog lists are arrays; administrative search/log endpoints use the paginated envelopes defined in OpenAPI. |

---

## 3. Asynchronous ingestion

Submit a document, receive a parse job, then poll that job for its result.

> CogniDocs processes documents asynchronously in the API process. Uploaded
> bytes are not durably retained. If the server restarts while a job is
> `queued` or `processing`, startup recovery marks the interrupted job
> `failed`; callers can then resubmit the source document.

### 3.1 Submit a document

Multipart upload:

```bash
curl -X POST "$BASE/documents" \
  -H "X-API-Key: $KEY" \
  -F "file=@invoice.pdf" \
  -F "declaredType=invoice"
```

JSON/base64 upload:

```bash
curl -X POST "$BASE/documents" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"fileBase64":"...","fileName":"stmt.pdf","mimeType":"application/pdf","declaredType":"bank_statement","password":"optional-pdf-password"}'
```

Fields:

- `declaredType`: `invoice` | `receipt` | `bank_statement` |
  `credit_card_statement` | `auto` (default). With `auto`, PDFs, images, and
  CSVs are classified and the choice is reported in `detectedType`.
- `password`: optional password for a protected PDF.
- Accepted files: PDF, PNG, JPEG, WEBP, and CSV (statements). Magic bytes are
  validated. Maximum decoded/file size is 20 MB for both transports.
- `declaredType` is validated identically for multipart and JSON. Omit it to
  use `auto`; an unrecognized value returns `400`.
- JSON requires canonical padded RFC 4648 base64. Data URLs, whitespace,
  malformed padding, and non-base64 characters return `400`. An empty JSON
  payload or empty multipart file also returns `400`.
- Use only `multipart/form-data` or `application/json`; other media types return
  `415`. Files over 20 MB return the same stable `413` JSON error for both
  transports before a job or quota reservation is created.
- Multipart accepts one file plus at most the `declaredType` and `password`
  fields. Excess parts or a form field over 4 KB return a stable `400` error.
- Protected PDFs return `422` with code `pdf_password_required` or
  `pdf_password_incorrect`. Correct the password and resubmit; no job is created
  for either password challenge.

The response is `202 Accepted` with a complete `ParseJob`:

```json
{
  "id": "6f1c...",
  "declaredType": "invoice",
  "detectedType": null,
  "status": "queued",
  "fileName": "invoice.pdf",
  "mimeType": "application/pdf",
  "fileSizeBytes": 48211,
  "startedAt": null,
  "parserPath": null,
  "confidence": null,
  "error": null,
  "aiPromptTokens": null,
  "aiCompletionTokens": null,
  "aiCostAmount10k": null,
  "sandbox": false,
  "result": null,
  "createdAt": "2026-08-17T09:00:00Z",
  "completedAt": null
}
```

### 3.2 Poll and retry

- `GET /jobs/{jobId}` returns one tenant-scoped job.
- `GET /jobs?status=&type=&limit=` returns recent tenant-scoped jobs, newest
  first. `limit` defaults to 100 and must be from 1 through 100.
- `status`: `queued` → `processing` → `completed` or `failed`.
- `completed` and `failed` are terminal. Stop polling either state.

Poll after about 2 seconds, then use exponential backoff with jitter up to about
10 seconds between requests. Retry network errors and transient `5xx`
responses. Do not retry `4xx` responses unchanged, and do not submit a duplicate
merely because a valid job is still `queued` or `processing`.

Authentication, password-reset, verification, and profile-photo upload routes
also enforce attempt limits. A `429` response means the caller must stop and
wait before trying again; do not immediately replay the request.

On `failed`, inspect `error` and resubmit only after correcting the input or
after a documented process restart interrupted the job.

`parserPath` is diagnostic metadata, not a job state. Invoice and receipt values
include `vendor_template`, `ai_text`, and `ai_vision`. Statement values include
`template_match:<parser>`, `template_generated:<parser>`, `ai:<parser>`, and
`unknown`.

Every job includes:

- `mimeType` and `fileSizeBytes`: submitted-file metadata. Either can be `null`
  for a legacy job whose original value was not retained.
- `startedAt`: when processing began, or `null` while queued and for legacy jobs
  where the timestamp is unrecoverable.
- `aiPromptTokens` and `aiCompletionTokens`: totals from all AI calls in the
  parse, including classification and fallback work; `null` for legacy jobs
  whose usage cannot be recovered.
- `aiCostAmount10k`: total AI cost in USD ×10,000 (`142` means `$0.0142`);
  failed jobs retain cost incurred before failure.
- `sandbox`: whether a sandbox API key submitted the job.

### 3.3 Canonical result envelope

```json
{
  "documentType": "invoice",
  "parserPath": "vendor_template",
  "confidence": 97,
  "statement": null,
  "invoice": {}
}
```

The envelope always contains both `invoice` and `statement`; exactly one branch
is populated for a completed job.

**InvoiceResult** (also used for receipts):

`id`, `vendorKey`, `vendorName`, `invoiceRef`, `normalizedInvoiceRef`,
`issueDate`, `dueDate`,
`currency`, `subtotalAmount10k`, `taxAmount10k`, `totalAmount10k`,
`categoryKey`, `detailTier`, `fieldConfidence`, `fieldsMissing`,
`reconciliation`, `sourceParser`, `arithmeticModel`, `paymentMethod`,
`paymentReference`, `associatedInvoiceRefs`, `bankingDetails`,
`templateRouting`, `merchantId`, and `lineItems[]`.

- A receipt uses `documentType: "receipt"`, `statement: null`, and a populated
  `invoice` branch. Receipt details such as card/cash are returned in
  `paymentMethod`; invoice-only fields can be `null`.
- `detailTier` is `itemized`, `hybrid`, or `summary`. A `hybrid` result exposes
  `reconciliation: { lineItemSum10k, matchesTotal, delta10k }`; discrepancies
  are flagged, never silently corrected.
- `fieldConfidence` contains per-field scores from 0 to 1. `fieldsMissing`
  lists canonical fields that could not be extracted.
- `arithmeticModel` records the validated arithmetic convention when one was
  identified. `reconciliation` retains the line-item sum, match flag, and
  integer `delta10k`.
- `paymentReference` and `associatedInvoiceRefs[]` retain receipt evidence.
  `templateRouting` records template detection, deterministic parse, layout,
  validation, and fallback results without exposing internal template
  revisions.
- `bankingDetails` contains supplier payment details printed on the document,
  or `null`. Its nullable fields are `bankName`, `accountName`,
  `accountNumber`, `iban`, `swiftBic`, `branch`, and `routingInfo`. Values are
  captured verbatim and never fabricated.
- Invoices are unique on `(vendorKey, normalizedInvoiceRef)`. Re-submitting the
  same invoice resolves to the existing canonical invoice instead of creating
  a copy.
- Every line item contains `id`, `lineNumber`, `section`, `description`,
  `quantity10k`, `unitPriceAmount10k`, `amount10k`, `taxAmount10k`,
  `periodStart`, and `periodEnd`.

**StatementResult**:

`bankId`, `bankName`, `statementType` (`bank_statement` |
`credit_card_statement` | `unknown`), `currency`, `accountRef`, `periodStart`,
`periodEnd`, `templateId`, `templateGenerated`, and `transactions[]`. Persisted
jobs created by older parsers can still return the legacy statement-type labels
`bank` or `credit_card`; new jobs use the canonical values above.

Each transaction includes:

- Core values: `id`, `date`, `description`, `rawDescription`, signed integer
  `amount10k`, `currency`, explicit `direction`, `type`, `balance10k`, and
  `page`.
- Source and normalization evidence: `sourceMerchant`, `sourceText`,
  `sourceAmount`, `currencySource`, `directionSource`, `normalizedMerchant`,
  `parsedMerchant`, `parserConfidence`, `parserVersion`, and `notes[]`.
- Categorization: `categoryGroup`, `parserCategory`, `directoryCategory`,
  authoritative `effectiveCategory` (also returned as `category`),
  `subcategory`, and `categoryProvenance`.
- Merchant matching: local `merchantId`, cross-system `stableMerchantId`,
  `matchConfidence`, `matchProvenance`, `matchMethod`, `matchEvidence[]`,
  `matchAlternatives[]`, `matchBlockedReason`, and `tenantOverride`.
- Entity and operation metadata: `entityType`, `operationType`,
  `operationLabel`, `flow`, `directionClassified`, `instrument`, `rail`, and
  `tag`.
- Source position: `sourcePage`, `documentIndex`, and `sourceLineIndex`.

Internal lookup/directory revision identifiers, ownership identifiers, API-key
identifiers, credentials, and full OCR/PDF text are never returned.

Statements are template-first. When no template matches, an AI fallback parses
the statement and can generate a reviewable template for future deterministic
imports.

### 3.4 Legacy and nullable field semantics

The canonical response is additive. Saved legacy envelopes are normalized at
read time before validation:

- Unrecoverable scalar/object evidence is `null`.
- Unrecoverable arrays, including statement notes/match evidence/alternatives
  and receipt-associated invoice references, are `[]`.
- A missing legacy statement `effectiveCategory` is backfilled from `category`.
- A missing `sourcePage` is backfilled from `page` when available.

CogniDocs does not reconstruct evidence that was never persisted. The
normalization is response-only and does not fabricate or rewrite historical
source data.

### 3.5 Download a complete document CSV

```bash
curl -L "$BASE/jobs/$JOB_ID/export.csv" \
  -H "X-API-Key: $KEY" \
  -o parsed-document.csv
```

`GET /jobs/{jobId}/export.csv` uses the same tenant-scoped, validated canonical
response as `GET /jobs/{jobId}`. It is available for completed jobs with a
structured result:

- Invoice and receipt exports contain one row per `result.invoice.lineItems`
  item. A summary result with no line items still emits one row.
- Statement exports contain one row per
  `result.statement.transactions` item. A statement with no transactions still
  emits one row.
- Headers are stable dotted canonical property paths such as `fileName`,
  `result.invoice.totalAmount10k`, and
  `result.statement.transactions.direction`.
- Job and document/header metadata repeat on every child row. Nested objects
  use dotted paths; arrays are JSON-encoded. Dynamic `fieldConfidence` entries
  are sorted and flattened below `result.invoice.fieldConfidence.*`.
- Null values are empty cells. Integer `*Amount10k` and `*10k` values remain
  integers, and statement direction remains an explicit separate column.
- Output is UTF-8 and RFC 4180 escaped with CRLF records. The
  `Content-Disposition` filename is sanitized from the source document name.
- Document-controlled text that begins with a spreadsheet formula prefix
  (`=`, `+`, `-`, or `@`, including after leading whitespace) is prefixed with
  a single quote so Excel and similar tools keep it literal. Numeric API values,
  including negative `*Amount10k` cells, remain numeric strings.

The route returns `404` for missing and foreign-tenant jobs without revealing
which case occurred. It returns `409` when the job is queued, processing,
failed, completed without a structured result, or has a result that cannot be
validated for export.

### 3.6 Download several document CSVs as one ZIP

```bash
curl -X POST "$BASE/jobs/export.zip" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"jobIds":["job-id-1","job-id-2"]}' \
  -o cognidocs-export.zip
```

`POST /jobs/export.zip` accepts 2 through 25 unique job IDs and returns
`application/zip`. It creates one canonical CSV per selected job using the same
format and spreadsheet-safety rules as the single-job export.

The operation is atomic: every selected job must belong to the caller, be
completed, contain a structured result, and pass canonical response validation.
Missing or foreign jobs return `404`; any non-terminal or unexportable job
returns `409`; duplicate IDs or an invalid selection return `400`. The combined
uncompressed CSV payload is capped at 20 MB; exceeding it returns `413`. No
partial archive is returned on any preflight failure. A stream failure after
download headers have been sent terminates the response, so clients should
discard incomplete ZIPs and retry the whole selection with backoff.

### 3.7 Completed credit-card statement example

The example below is abridged; nullable evidence fields listed above are omitted
for readability.

```json
{
  "id": "6f1c...",
  "declaredType": "credit_card_statement",
  "detectedType": "credit_card_statement",
  "status": "completed",
  "fileName": "card.pdf",
  "parserPath": "template_match:v3",
  "confidence": 96,
  "error": null,
  "aiPromptTokens": 0,
  "aiCompletionTokens": 0,
  "aiCostAmount10k": 0,
  "sandbox": true,
  "result": {
    "documentType": "credit_card_statement",
    "parserPath": "template_match:v3",
    "confidence": 96,
    "statement": {
      "bankId": 12,
      "bankName": "Example Bank",
      "statementType": "credit_card_statement",
      "currency": "AED",
      "accountRef": null,
      "periodStart": "2026-07-01",
      "periodEnd": "2026-07-31",
      "templateId": "42",
      "templateGenerated": false,
      "transactions": [
        {
          "id": "9001",
          "date": "2026-07-02",
          "description": "Coffee Shop",
          "rawDescription": "COFFEE SHOP DUBAI",
          "amount10k": 419400,
          "currency": "AED",
          "direction": "debit",
          "type": "expense",
          "category": "Dining",
          "merchantId": "301",
          "balance10k": null,
          "page": null
        },
        {
          "id": "9002",
          "date": "2026-07-10",
          "description": "Card Payment",
          "rawDescription": "PAYMENT RECEIVED",
          "amount10k": -5000000,
          "currency": "AED",
          "direction": "credit",
          "type": "payment",
          "category": "Payment & Transfers",
          "merchantId": null,
          "balance10k": null,
          "page": null
        }
      ]
    },
    "invoice": null
  },
  "createdAt": "2026-08-17T09:00:00Z",
  "completedAt": "2026-08-17T09:00:03Z"
}
```

---

## 4. Supported endpoint groups

Access labels below match `x-operation-access`:

- **Authenticated:** browser session or API key.
- **Session-only:** signed-in browser session; API keys are rejected.
- **Admin / super-admin:** authenticated, plus the stated current user role.
- **API-plan gated:** authenticated, plus a plan with API access; admins are
  exempt from the plan check.

### 4.1 Documents and jobs (authenticated)

- `POST /documents`
- `GET /jobs`
- `POST /jobs/export.zip`
- `GET /jobs/{jobId}`
- `GET /jobs/{jobId}/export.csv`

### 4.2 Invoice templates (admin)

- `GET|POST /invoice-templates`
- `GET|PATCH /invoice-templates/{id}`
- `DELETE /invoice-templates/{id}` (super-admin)
- `POST /invoice-templates/{id}/activate`
- `POST /invoice-templates/{id}/rollback`

Known vendors are parsed deterministically. AI parsing of a new vendor can
propose a draft template for review and activation.

### 4.3 Statement templates (admin)

- `GET /statement-templates`
- `GET /statement-templates/recoverable-lineages`
- `GET /statement-timing-report`
- `GET|DELETE /statement-templates/{id}`
- `GET|POST /statement-templates/{id}/versions`
- `POST /statement-templates/{id}/activate`
- `POST /statement-templates/{id}/rollback`
- `GET /statement-templates/{id}/health`

`POST /statement-templates/{id}/versions` creates a reviewable child revision
without mutating historical versions. Direct
`PATCH /statement-templates/{id}` is a compatibility-only handler that always
returns `409` and directs callers to the versioned endpoint; it is intentionally
excluded from generated clients.

### 4.4 Categories, merchants, and banks

- `GET /invoice-categories` is authenticated; create/update is admin-only.
- `GET /invoice-categories/{key}/profiles` and
  `POST /invoice-categories/{key}/profiles/{version}/activate` are admin-only.
- `GET /merchants/taxonomy` and `GET /merchants/regions` are authenticated
  read-only reference data.
- `/my/merchants` (`GET`, `POST`, `PATCH`, `DELETE`) manages the caller's own
  overrides.
- Global merchant curation, unmatched review/dismissal, corrections, backfill,
  merge, and absorption review/detach operations are admin-only.
- `GET /banks` and `GET /banks/{id}` are authenticated; create/update/alias
  operations are admin-only.

### 4.5 Keys, plans, billing, and documentation

- `/api-keys`: list/create/revoke owned keys.
- `GET /plans`, `GET /billing`, `POST /billing/plan`: authenticated.
- `GET /billing/history`: authenticated.
- `POST /billing/checkout`, `POST /billing/portal`, and
  `POST /billing/cancel`: session-only. API keys cannot start checkout, open a
  billing portal, or cancel a subscription.
- `PATCH /plans/{key}`, `GET /billing/users`,
  `PATCH /billing/users/{id}/plan`: super-admin.
- `GET /docs/openapi.yaml`, `GET /docs/api-guide`: legal acceptance and
  API-plan gated for ordinary users; platform admins are exempt from the plan
  gate. Both routes accept a session or API key after those checks.

### 4.6 Browser account and operator endpoints

- `/auth/*`: public registration/login/reset plus session-only profile,
  password, and 2FA management.
- `/admin/*`: admin-only, except production test-data purge, which is
  session-only and super-admin-only.
- `POST /chat/route`: authenticated console helper.
- `GET /design-system/export`: console-only binary design-system export, not an
  external CogniDocs integration operation. It is intentionally outside the
  OpenAPI contract.

The OpenAPI document is the authoritative list of request/response schemas and
individual operations in these groups.

---

## 5. Typical ERP/back-office recipe

1. Sign in and create a dedicated API key. Use a sandbox key in development.
2. Submit each source document to `POST /documents`; set `declaredType` when
   known, otherwise use `auto`.
3. Poll `GET /jobs/{id}` with the backoff guidance above.
4. On `completed`, read `result`. Divide `*Amount10k` by 10,000 only for
   display. Respect `detailTier`, `fieldsMissing`, and reconciliation deltas
   before posting to a ledger.
5. For statement cash-flow logic, use `direction`, not amount sign.
6. On `failed`, surface `error` to an operator. The service does not guess.
7. Admins should periodically review unmatched merchants and draft templates to
   improve deterministic coverage.

## 6. Status and error codes

| Code | Meaning |
|---|---|
| 200 / 201 / 202 / 204 | Success (`202` = parse job accepted; `204` = no response body) |
| 400 | Invalid input, malformed/base64 content, unsupported file, or failed validation; correct the request before retrying |
| 401 | Missing/invalid credentials, inactive key/account, or missing required browser session |
| 402 | Paid self-service plan checkout is not available |
| 403 | Legal acceptance, role, plan, sandbox entitlement, or hard quota denied |
| 404 | Resource not found (tenant-scoped resources also use 404 to avoid data leaks) |
| 409 | Conflict, such as rollback with no prior version or a compatibility-only template update |
| 413 | Document exceeds the 20 MB file limit, or selected batch CSVs exceed the 20 MB uncompressed archive limit; reduce the payload |
| 415 | Document upload did not use `multipart/form-data` or `application/json` |
| 422 | PDF password is missing or incorrect; supply/correct it before resubmitting |
| 429 | Too many authentication, reset, verification, or profile-photo upload attempts; wait before retrying |
| 500 / 503 | Internal or temporarily unavailable service; retry with backoff only when safe |

A parse accepted with `202` can later fail. That is represented by a successful
job lookup whose body has `status: "failed"` and the diagnostic in `error`.