---
name: Signing-entity authorised signatories
description: Per-entity authorised-signatory gate on contract Sign & send (firm-side signing)
---

- Each signing entity may have an authorised-signatories list (`atelier_signing_entity_signatories`, unique on orgId+entityId, `userIds` jsonb ordered). **Empty/missing list = legacy behaviour: any partner-tier manager may sign.** Don't treat empty as "nobody".
- `signFirst: true` on send-for-signature is the gated surface: server 403s (`not-authorised-signatory`) when the caller isn't on the list, and 403s (`sign-first-not-caller`) when the first signer's email isn't the caller's. Non-signFirst sends are ungated on purpose (counterparty-first flow).
- **Why:** the button split is UI-only sugar; the security boundary is server-side on the send route — new send surfaces (chat/CLI capabilities) must reuse the same gate.
- `POST /contracts/:id/request-signature` sets firmSignatureRequested* awaiting fields + emitSelfNotification to each signatory; ANY successful send clears those fields.
- Contract detail response carries `signing: {signatories, viewerIsAuthorisedSignatory}`; FirmProfile manages lists via `PUT /signing-entities/:entityId/signatories` (partner-tier, live-user validated, audited).
