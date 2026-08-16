---
name: Alliance partner portal invariants
description: Security model for external alliance_partner logins (grant-scoped opportunity visibility, clamps, provisioning).
---

# Alliance partner portal (external logins)

- Role `alliance_partner` is external: user row carries `partnerFirmId`; visibility comes ONLY from active rows in `atelier_partner_opp_grants` (soft revoke via revokedAt; archived firm = immediate 403). No table RLS — isolation is explicit orgId predicates + the central gate (security-log precedent).
- Central gate allows only /me, /personas (self-only), /partner-portal*, /cli* — and inside /cli, `/cli/attachments*` is explicitly 403'd BEFORE the /cli allowance (attachment digests are an internal-document side channel). The attachment router has a path-scoped defense-in-depth guard too.
- **Chat clamp needs BOTH layers**: `capabilitiesForPersona` slice AND an early return in `getToolsForPersona` — otherwise the legacy TOOL_REGISTRY fallthrough (appended for every non-self-only role) leaks org-wide read tools like resolve_account_by_name. Any future restricted role must be added to both.
- Redacted account overview is an explicit field allowlist (name, brandName, sector, country, hqCity, size, employeeCount); probes assert keys === allowlist exactly.
- Provisioning: alliance flow must NEVER reuse an existing user identity (resolveLinkedUserIdForPerson matches email without org predicate → cross-org/privileged takeover). Blanket 409 on any existing users email + always mint fresh row. Concurrent same-email race is serialized by the `atelier_auth_credentials.email` PRIMARY KEY inside the one transaction; map SQLSTATE 23505 (check err.code AND err.cause.code — drizzle wraps pg errors) to 409. No unique index on atelier_users.email (historical internal reuse is intentional).
- Partner-portal routes are raw-fetch, not in openapi (account-agent precedent). But /me and /personas responses ARE zod-validated against the api-spec role enum — any NEW role must be added to the openapi role enum + codegen rerun or /me 500s for that role.
- Chat clamp is FOUR layers, all required: (1) capabilitiesForPersona slice, (2) getToolsForPersona early return (no legacy registry append), (3) findToolByName returns undefined outside the surface + meta allowlist (otherwise the catalog fallthrough runs hallucinated tools), (4) dispatch-time surface-membership refusal in the turn loop (shared RESTRICTED_META_ALLOW with self-only roles).
- The alliance /cli gate is a sub-path allowlist (turn/confirm/cancel, sessions, events, capabilities, pending-clarification, recent, feedback); help/admin/recordings/attachments stay 403.

## Preview & multi-login invariants
- Every portal route in EVERY router must resolve the firm through the one shared preview-aware resolver — a local partner-only resolver breaks leadership preview. Partners can never preview another firm (their own firm always wins). Preview refuses all mutations BEFORE multipart parsing, never sends emails, and audits entry reads.
- Multi-login per firm is allowed (old one-active-login unique index removed on purpose — never reintroduce); offboarding deactivates all firm logins + revokes sessions; partner sessions are short-TTL.
- The web-only mobile restriction is NOT the body `client` flag (model/caller-trusted UX only) — the durable boundary is the central gate locking partners out of /me/* mobile surfaces; keep push/device routes rejecting partners.
- Reset-link supersede must invalidate BOTH activation and partner_registration tokens, or fresh partners keep two live links.
- Partner notification hooks for contract/invoice events are deliberately deferred — firm linkage is ambiguous name-join, don't notify on unverified matches.
- The portal per-user throttle must mount once on the common parent router or separately-mounted portal routers bypass it.

## Delivery view & shared documents
- Partner delivery reads compose through ONE pure allowlist wire-builder (deep-scanned by probes for forbidden keys); engagement phase = plmStage, health = raidStatus — there is no separate status column. The redacted account overview nests under the engagement, not at response root.
- Documents shared to a firm are byte-COPY snapshots into firm-scoped storage keys; dedupe and unreference-deletion are per-firm only — org-global dedupe would be an existence side-channel.
- Partner uploads are multipart, parsed route-LOCALLY (multer memoryStorage) only AFTER firm resolution + preview refusal — never via a path-scoped pre-parser, which consumes bytes before preview auth. Upload statuses: pending_review|accepted|rejected; review decisions use the full words.
- Internal reviewers need a leadership byte-download surface for uploads/shares (completion review rejects accept/reject UIs with no way to inspect the file).

## Self-service change requests (partner portal)
- Partner change requests reuse the firm pendingUpdates proposal queue (no new table); entries are flagged partner-submitted and a resubmit for the same field supersedes the prior pending one. **Why:** review gating — nothing partner-writable applies directly.
- REST route and the chat write tool share ONE allowlist + write helper; bank fields always hard-reject to the finance bank-change flow. **Why:** a single write path prevents allowlist drift between surfaces.
- The alliance_partner catalog gate admits exactly one write tool; widening it further must be deliberate + ratchet-updated.
- Change-request toValue is NOT always a string on the wire (capabilities = string[]); portal renderers must format unknown values defensively, and company-profile capabilityProfile is an object, not a string.
