---
name: Signing-entity authorised signatories
description: Per-entity authorised-signatory gate on contract Sign & send (firm-side signing)
---

- Each signing entity may have an authorised-signatories list (`atelier_signing_entity_signatories`, unique on orgId+entityId, `userIds` jsonb ordered). **Empty/missing list = legacy behaviour: any partner-tier manager may sign.** Don't treat empty as "nobody".
- The gate now lives INSIDE `sendContract` (shared service), not the route: pass `caller: {userId, email}` (+ `signFirst` when explicit). It fires when signFirst is set OR the caller's email appears among the signers (implicit "I sign this myself"). Error codes `not-authorised-signatory` / `sign-first-not-caller` map to 403 at the route and to snake_case CLI errorCodes.
- **Why:** CLI/chat capabilities call `sendContract` directly; a route-only gate let a non-signatory list themselves as signer and bypass the 403. Any NEW send surface must pass caller identity (CLI looks up the persona's email from atelier_users — CliPersona has no email field).
- Pure counterparty sends (caller not a signer, no signFirst) stay ungated on purpose.
- `POST /contracts/:id/request-signature` sets firmSignatureRequested* awaiting fields + emitSelfNotification to each signatory; ANY successful send clears those fields.
- Contract detail response carries `signing: {signatories, viewerIsAuthorisedSignatory}`; FirmProfile manages lists via `PUT /signing-entities/:entityId/signatories` (partner-tier, live-user validated, audited).
