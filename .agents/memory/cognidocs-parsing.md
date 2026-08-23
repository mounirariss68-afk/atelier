---
name: CogniDocs document parsing
description: Invariants for the CogniDocs API integration that replaced in-house receipt/invoice/statement parsing (client, converters, dedupe, testing pattern).
---

All receipt, supplier-invoice and PDF bank-statement parsing goes through the company's own CogniDocs service (`src/lib/cognidocs/` in api-server). In-house extraction remains ONLY for: vendor tooling-invoice mining (needs credits/discount semantics) and bank letters (Anthropic). Do not re-add vision/OCR parse paths.

**Invariants:**
- Amounts on the wire are INTEGERS ×10,000 (`…10k`); divide by 10,000 for majors. Preserves 3-decimal Gulf currencies.
- Statement row sign comes ONLY from the explicit `direction` field: debit→negative, credit→positive, magnitude = |amount10k|. `direction: null` → row flagged and skipped, never guessed. Any code inferring sign from wording/columns is a regression.
- Key selection: production (REPLIT_DEPLOYMENT) → COGNIDOCS_API_KEY only; dev/test → sandbox ?? main; neither → loud typed "not-configured" (never silent). Base URL overridable via COGNIDOCS_BASE_URL for stubbing.
- Preview→confirm determinism: results are retained per jobId, so phase 2 re-fetches the SAME pinned job (statement: `cognidocsJobId` inside the HMAC-covered pending input; web bank import: HMAC over jobId+file-sha). Never re-submit at commit.
- `invoice.id` is CogniDocs' stable per-underlying-invoice id — persisted as `cognidocs_invoice_id`, third supplier-invoice dedupe signal (works across different bytes AND different printed references).
- Hard caps: 20MB upload, media set is PDF/PNG/JPEG/WEBP/CSV — GIF rejected, HEIC converted to JPEG app-side first (callers own the conversion, the CogniDocs receipt helper does NOT).
- `declaredType`: supplier-invoice ingest declares "invoice"; receipts and statements stay "auto" ON PURPOSE (expense docs are a mix of till receipts/tax invoices; statement surfaces take bank AND credit-card). Either way a non-matching payload fails loud, never forced.
- The billing-hub REST upload parses too (best-effort, short bounded budget so the synchronous request can't 502): parsed fields fill only blanks, user-typed values always win, failure is reported in the response but never blocks a complete manual submission.
- Schema arrives BOTH ways: dev via drizzle push AND a versioned idempotent migration file in lib/db/drizzle (recent convention — see 0074+), so deployed DBs get new columns.
- Confidence: job 0–100; receipts band ≥80 green / ≥50 amber; supplier + statement floors are 0.6 (below → correction clarification / CSV-export refusal).
- LIVE service deviates from the guide on dates: statement transaction dates (and invoice issueDate) come back as full ISO 8601 timestamps, not YYYY-MM-DD. The statement converter takes the LITERAL date part of the string (regex, never a timezone-shifting Date parse); garbage tokens stay flagged. Confirmed live 2026-08-23 (invoice/receipt/statement all green on real keys; auto classification refuses weak-evidence docs with a "re-upload with explicit type" error — fail-loud, handled).
- Parsed statement rows commit through the shared CSV import core via a canonical CSV serialized at FOUR decimals — 2dp would silently round 3-decimal currencies (KWD/BHD/OMR); the canonical text also feeds the dedupe hash, so the serialization must stay deterministic.

**Live-verified 2026-08-23** (sandbox key, invoice PDF + HEIC receipt + statement PDF all green). Deviations & provider facts learned:
- Date fields arrive as ISO datetimes ("2026-07-02T00:00:00.000Z") despite the spec's `format: date` — every converter normalizes via `cognidocsDateOnly()` in convert.ts (accepts both shapes, else flag/skip). Stub/contract suite covers both.
- `declaredType: "auto"` can REFUSE sparse/unfamiliar docs: job fails loud with "insufficient evidence" classification error. Explicit `bank_statement` / `credit_card_statement` declares exist in the enum (statements still submit "auto" on purpose — surface takes both kinds).
- Photo OCR is English-only (Arabic/Turkish OCR planned) — Arabic/Turkish receipt *photos* parse unreliably; digital PDFs support EN/AR/TR.
- Polling only (webhooks planned); no upload rate limits currently; results retained indefinitely; resubmitting a known invoice succeeds and returns the SAME `invoice.id` (never an error) — that id equality is the duplicate signal until their explicit marker ships.
- Observed once on a synthetic statement: the service mis-signed a row (salary debit returned as `direction: "credit"`). App trusts `direction` by contract; rows carry `balance10k`, usable for a future balance-delta cross-check.

**Why:** the service owns parsing quality; app-side guessing (sign inference, forced field extraction, silent fallbacks) is what the migration removed — reintroducing it silently corrupts financial data.

**How to test:** `tests/helpers/cognidocs-stub.ts` (`startCognidocsStub()` sets env; must run BEFORE capability imports; jobs replay deterministically across `state` swaps — swap `state.invoice`/`state.statement` sequentially per section; `failNext`, `confidence`, `pendingPolls` knobs). Offline contract suite: `test:cognidocs`. E2E suites: `test:merchant-parse`, `test:finance-docs`. Live smoke (needs real key, manual): `scripts/cognidocs-live-smoke.ts --invoice/--receipt/--statement <files>`.
