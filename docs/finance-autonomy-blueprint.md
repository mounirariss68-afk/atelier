# Finance on Autopilot — Design Blueprint

**Audience:** the two founders. Written in plain language, grounded in what is already built in Atelier today.
**Purpose:** define how Atelier's finance & accounting function runs on agents (AI + deterministic rules) instead of hires — with the founders approving only what genuinely needs judgment, and everything reachable through Riser (chat).
**Status:** design for ratification. The build tasks (#1090 Riser document intake, #1091 autopilot + unified approvals inbox) implement this.

---

## 1. Operating model in one page

Atelier's finance department is a set of **agents** working over a **double-entry general ledger**, with **one approvals inbox** for the founders.

- **Deterministic rules do the bookkeeping.** Posting rules, matching logic, VAT/CT math, payment-run assembly, dunning ladders — these are code, not AI. They behave the same way every time and are auditable.
- **AI does the reading and judgment-light work.** Parsing invoices, receipts, bank letters and statements; recognizing merchants; classifying documents; drafting collections emails; explaining variances. AI output always carries a **confidence score** and is either auto-accepted (high confidence, low stakes) or queued for review.
- **Founders approve only four kinds of things** (Section 4): money leaving the firm, closing/reopening a period, changes to where money can be sent (bank details), and statutory filings. Everything else auto-posts with an audit trail and a one-click reverse.
- **Everything an agent does is visible and correctable.** No silent edits: posted journals are corrected by reverse-and-repost, and every record shows who/what/why (Section 5).
- **Riser is the front door.** Attach a supplier invoice, a bank statement, a receipt or a bank letter in chat; the right pipeline runs; you get progress, one clarification only when the agent is genuinely unsure, an approval card when your sign-off is required, and a link to the record in Finance (Section 7).

With two founders, classic segregation-of-duties (preparer ≠ approver ≠ payer) is impossible with humans alone. Here the **agent is the preparer**, the **founder is the approver**, and the **audit log is the independent record** — that is the control model throughout.

---

## 2. What exists today (process inventory)

Grounded inventory of the current finance stack. ✅ = works today, 🟡 = partial, 🔴 = stub/placeholder.

| Flow | Today | State |
|---|---|---|
| **Supplier invoices (AP in)** | Upload on Payables page → parse → review → approve; advisory-lock dedupe; bank hold when firm-linked | ✅ (upload UI only, no chat) |
| **Self-billing (RCTI)** | Self-Billing Clerk builds invoices from approved timesheets; reruns skip approved/disputed/paid | ✅ |
| **Payment runs** | Maker-checker: build (advisory-lock claim) → partner approves → mark paid | ✅ |
| **Vendors / POs / 3-way match** | Routes exist but return empty/404 | 🔴 stubs |
| **Client invoicing (AR)** | Draft/compose/issue (`issueInvoiceCore`), void = founding partner, dunning ladders, promises-to-pay | ✅ |
| **Collections** | Collections Agent drafts dunning emails from the default ladder per jurisdiction; approve-to-send | ✅ |
| **Cash application** | Statement/receipt matcher proposes (`matchProposal`), confirm → Bookkeeper posts GL | ✅ |
| **Bank statement recon** | Import (`importStatementCore`) + auto-match, recon periods, exceptions derived at read time, finalise gated on acknowledgement | ✅ (upload UI only, no chat) |
| **GL posting** | Bookkeeper + BookkeeperAuto post journals; no-double-post guards; auto chart seeding | ✅ |
| **Period close** | Close cycles with checklist, CT provision accrual, **two distinct partners** sign off, fp-only reopen (conditional lock release) | ✅ |
| **Financial statements** | P&L/BS/CF derived from GL journals; period locks → preliminary flags; identities hold by construction | ✅ |
| **Payroll** | Statutory + simple runs; partner approve posts journal; comp fields only via audited payroll PATCH | ✅ |
| **Statutory / compliance** | Five DB-backed registers; overdue derived at read time; audited mark-filed/reopen | ✅ |
| **Receipts / expenses** | Chat + mobile upload, OCR with ≥4KB guard, merchant recognition (alias→memory→fuzzy→keyword→AI), founder self-approval, reimburse idempotent | ✅ |
| **Bank letters / entity bank accounts** | Extract-from-letter into entity registry; credentials visible only to fp/partner/finance | ✅ |
| **Planning / forecast** | 13-week cash (registry fiscal tax lines), plan/comply/reports on real facts | ✅ |
| **CFO cockpit tiles** | `cfoPrimitives.tsx` has Wave-N placeholder tiles; "Long-range" plan card is a dead placeholder | 🔴 placeholders |
| **Chat parity** | Many finance routes annotated `@cli-skip` — not reachable from Riser | 🟡 |
| **Approvals surfaces** | Scattered: Me-home card (timesheets/leave/expenses only), `/wallet/approvals`, close page, payables tabs | 🟡 fragmented |

**Conclusion:** the ledgers, matchers and agents largely exist. The gaps are (a) chat as the universal intake, (b) one approvals inbox, (c) autopilot scheduling/chaining of the agents, and (d) removing stubs.

---

## 3. Target process maps (per flow)

Legend: **[A]** agent/AI step · **[D]** deterministic rule · **[F]** founder approval · **[i]** informational (visible, no action needed).

### 3.1 Document intake (any channel: Riser, web upload, mobile)
1. **[D]** SHA-256 dedupe (same bytes = same document, org-scoped).
2. **[A]** Classify: supplier invoice / bank statement / receipt / bank letter / client contract / unknown. Confidence scored.
3. **[D]** Route to the flow-specific pipeline below. `unknown` or low-confidence classification → one clarifying question in chat ("This looks like X — is that right?"), never a guess.
4. **[i]** Progress streamed (async job + recap card in chat; record visible in Finance immediately as "processing").

### 3.2 Accounts payable (supplier invoice → payment)
1. **[A]** Parse invoice (vendor, amounts, tax, IBAN if present, due date). Confidence per field.
2. **[D]** Dedupe against existing AP (vendor+number+amount), advisory-lock atomic.
3. **[D]** Vendor resolution against known counterparties; **new vendor or changed bank details → [F]** (this is the classic invoice-fraud vector).
4. **[A]** Coding proposal (GL account, entity, VAT treatment) via merchant-recognition tiers.
5. **[D/F]** Gate by amount & confidence (matrix, Section 4): small + high-confidence auto-approves into "ready to pay"; otherwise queued for founder review with the parsed fields shown against the document image.
6. **[D]** Payment run assembled (advisory-lock, bank-IBAN gate) → **[F] partner approves the run** → mark paid → **[D]** Bookkeeper posts payment journals.
7. Vendors/PO/3-way match stubs: **defer & remove routes** (Section 6) — a two-founder consultancy has no PO discipline to match against; revisit if procurement volume appears.

### 3.3 Accounts receivable (engagement → cash)
1. **[D]** Billing triggers (FOR UPDATE-claimed) draft invoices; **[F] founder issues** (issuing creates a legal claim — always human).
2. **[D]** Dunning ladder schedules reminders; **[A]** Collections Agent drafts each email; **[F] approve-to-send** (outbound client-facing — always human, one click from the inbox).
3. **[A]** Cash application: matcher proposes; **[D]** exact single-candidate match auto-applies with audit; ambiguous/partial → review queue.
4. **[D]** Promises-to-pay tracked; broken promises escalate as inbox items **[i→F]**.

### 3.4 Bank & reconciliation
1. **[A]** Statement parsed (any channel) → **[D]** import with race-safe dedupe.
2. **[D]** Auto-match against expected cash movements; **[A]** proposes matches for the remainder.
3. **[D]** Exceptions derived at read time; unreconciled items age into inbox nudges **[i]**.
4. **[F]** Recon period finalise stays founder-acknowledged (it feeds close).

### 3.5 GL & period close
1. **[D]** BookkeeperAuto posts routine journals continuously (no-double-post guards).
2. **[A]** Close Controller runs the checklist, computes CT accrual (non-reversing), flags ties (probe journals use cash, not 1100 — ar_tie).
3. **[F]** Sign-off requires **two distinct partners** (kept — this is the strongest control in the system and both founders exist).
4. **[F]** Reopen is fp-only with conditional lock release. Post-close corrections only via reverse-and-repost in the new period.

### 3.6 Payroll & statutory
1. **[D]** Runs computed from roster payroll fields (only writable via the audited payroll PATCH).
2. **[F]** Partner approves the run → **[D]** journal posts. Payroll is money-out: always approved.
3. **[D]** Statutory registers derive overdue at read time; **[A]** drafts filing packs where possible; **[F] mark-filed** is always founder (it's a legal attestation).

### 3.7 Planning & forecast
Fully automatic **[D/A]**, informational only: 13-week cash from registry fiscal lines, margin/burn sentinels raise inbox nudges when thresholds breach. No approvals — nothing here moves money.

---

## 4. Approval & confidence matrix (the single taxonomy)

This one table is applied uniformly by all build tasks. "Auto" always means: posted with full audit trail and a one-click reverse.

| Action | Who approves | Auto threshold | Reversible how |
|---|---|---|---|
| Pay a supplier / payment run | **Founder (partner), always** | never auto | payment can't be recalled → prevention-first (see bank-detail row) |
| Approve supplier invoice into "ready to pay" | Founder, unless small & confident | auto if ≤ AED 1,000-equivalent **and** all key fields ≥ 0.9 confidence **and** known vendor | un-approve before run; after payment: credit note |
| New vendor / changed vendor bank details | **Founder, always** (typed-name confirm in chat) | never auto | edit registry |
| Issue a client invoice | **Founder, always** | never auto | void (fp-only) / credit note |
| Send a dunning/collections email | **Founder, always** (one click) | never auto | n/a (outbound) |
| Apply cash to an invoice | agent | auto on exact single-candidate match | reverse application (exists) |
| Post a routine journal (Bookkeeper) | agent | always auto (deterministic rules) | reverse-and-repost |
| Post an AI-coded journal (parsed doc) | agent / founder | auto if confidence ≥ 0.9 and ≤ AED 5,000; else review queue | reverse-and-repost |
| Reverse a posted journal | **Founder** | never auto | re-reverse |
| Finalise a recon period | **Founder** | never auto | reopen exception flow |
| Close a period | **Two distinct partners** | never auto | fp-only reopen |
| Statutory mark-filed | **Founder** | never auto | audited reopen |
| Payroll run | **Founder (partner)** | never auto | reversal journal |
| Expense reimbursement | founder (self-approval allowed with founder_self stamp) | per existing policy table | idempotent, credit entry |

**Confidence policy for AI-parsed data:** every parsed field carries a score. A document auto-proceeds only when *all* fields the posting depends on clear the bar; one weak field queues the whole document with the weak field highlighted. Unreadable never becomes a guess (existing rule: unreadable → needsReview, never filename+0). Thresholds (0.9 / AED 1,000 / AED 5,000) are **settings the founders can change**, seeded with these defaults — this is decision **D1** to ratify.

---

## 5. The review-&-revise contract

Every agent-posted record obeys:

1. **Attribution:** who (agent name + run id, or user), what (payload), why (source document link + rule/confidence that triggered it) — on the record and in the audit log.
2. **Findability:** appears in the relevant Finance page immediately, plus a "posted by agents" filter; nothing exists only "inside the agent".
3. **Correction = reverse-and-repost.** Posted journals are never edited in place. A "Fix this" action creates the reversing journal and a corrected repost as one audited operation. Pre-posting drafts (parsed-but-not-posted) are freely editable.
4. **Learning:** corrections feed the merchant/coding memory (existing alias-learning tier) so the same mistake isn't repeated — but learned rules never widen approval gates.
5. **Staleness:** long-running agent work uses the existing freshness rules (`agentRunIsFresh`) — a dead run shows as failed, never spins forever.

---

## 6. Gap & stub inventory (dispositions)

| Item | State | Disposition |
|---|---|---|
| Vendors / PO / 3-way-match routes (`financePayablesRoutes.ts`) | return empty/404 | **Remove** the dead routes; vendor registry folds into counterparty resolution (3.2). Revisit POs only if real procurement volume appears. |
| `cfoPrimitives.tsx` Wave-N placeholder tiles | render placeholders | **Remove** placeholders; keep only tiles backed by real data. |
| "Long-range" plan card | dead placeholder | **Remove** (13-week cash + sentinels cover the need). |
| `@cli-skip` finance routes | no chat parity | **Build** chat capabilities for the read/approve surfaces founders actually use (per #1090/#1091); keep `@cli-skip` for admin-rare surfaces, each with a reasoned exclusion in the parity registry. |
| Approvals scattered across 4+ surfaces | fragmented | **Build** the unified approvals inbox (#1091): one queue feeding Me-home card, web page, mobile and chat; existing pages deep-link into it. |
| Supplier-invoice & statement intake web-only | no chat intake | **Build** in #1090 (Section 7). |
| Manual agent triggering (clerk/close/collections run on demand) | manual | **Build** autopilot scheduling in #1091 (Section 8). |

Nothing else on the finance surface is a stub; after these dispositions, no empty stubs remain.

---

## 7. Riser orchestration design (#1090)

Reuses the existing chat machinery end-to-end — no new frameworks.

1. **Attach** — existing attachments pipeline (SHA dedupe, 30-min continuity primer, digest-per-org).
2. **Classify** — intake classifier (Section 3.1) as a chat-side step; result stated in the reply ("Reading this as a supplier invoice from X…").
3. **Route** — dispatch to the flow pipeline via the durable background-job registry (`async_dispatched` frame); chat returns instantly, proxy-safe.
4. **Progress** — `proactive_recap` cards with "⇒ outcome" lines per commit (existing recap contract; every out-of-runTurn commit appends its own outcome line).
5. **Clarify only on uncertainty** — one `needs_disambiguation`/clarification per genuine ambiguity, via the shared clarification resolver; never a quiz.
6. **Approve** — where the matrix requires a founder: `needs_confirmation` card with the parsed summary; **typed-name confirm** for the risk tier (payments, bank-detail changes) per the existing typed-name guard.
7. **Commit + navigate** — isWrite capabilities return `navigateTo` to the record in Finance (validator-enforced).
8. **Role gating** — finance document intake and approvals are fp/partner/finance capabilities; bank credentials follow the exposure rule (fp/partner/finance only, redacted elsewhere); self-only roles (employee/contractor) keep me.\*-only chat — a receipt from an employee is an *expense* flow, not a finance-department flow.

---

## 8. Autopilot & unified approvals inbox (#1091)

- **Scheduling:** the existing agent runner gains a schedule/chain layer: statement import → auto-match → cash application → recon nudges; timesheet approval → self-billing clerk; month boundary → close controller checklist; dunning ladder ticks → collections drafts. All runs are idempotent (existing rerun-skip semantics) and heartbeat-fresh.
- **Unified inbox:** one `approvals` queue table/view aggregating: payment runs, invoice issuance, collections sends, review-queue documents, close sign-offs, statutory filings, payroll runs, vendor bank-detail changes, HR items already on the Me-home card. Each item: what, why, money impact, confidence, source doc, approve/adjust/reject. Surfaced identically on web, mobile, and as a Riser capability ("what needs my approval?").
- **Notification discipline:** inbox items push once (existing dedupe-keyed reminder cards); daily digest instead of per-item spam for informational nudges.

---

## 9. Decisions for the founders to ratify

- **D1 — Thresholds:** auto-approve supplier invoices ≤ AED 1,000 (known vendor, ≥0.9 confidence); auto-post AI-coded journals ≤ AED 5,000 at ≥0.9. Adjustable settings, these are the defaults.
- **D2 — Remove the PO/3-way-match stubs** rather than build them now.
- **D3 — Keep two-partner close sign-off** (vs. relaxing to one founder + agent attestation).
- **D4 — Outbound always human:** every client-facing email (invoices, dunning) needs a founder click. The alternative (auto-send first reminder) is deferred until the ladder has a track record.
- **D5 — Currency of thresholds:** AED-equivalent via the existing display-currency conversion.

Once ratified, #1090 and #1091 build exactly this; any deviation comes back as a design change, not a silent drift.
