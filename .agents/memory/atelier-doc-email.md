---
name: Chat document-email via Outlook
description: Invariants for the me.document_email / email_my_documents chat capability (Graph mail drafts/sends of own person documents)
---

- Any ok:true result from an isWrite capability that isn't a confirmation/disambiguation/clarification envelope trips the navigateTo validator — an ad-hoc `{prompt, options}` disambiguation payload must carry explicit `navigateTo: null` (or use a proper disambiguation key).
- Graph mail: drafts via POST /me/messages (returns webLink), direct send via POST /me/sendMail (202, no body); attachments are inline base64 fileAttachment, ~3 MB/file cap — larger needs upload sessions (deliberately out of scope, refused honestly).
- Mail.ReadWrite/Mail.Send were added to MS_SCOPES later than calendar scopes: existing connections lack them, so commit path must re-check freshAccessToken().scopes and return ms_reconnect_required, not a raw Graph 403.
- Document fuzzy matcher needs a specificity pass: `q.includes(kind)` alone makes "UAE Visa 2025" match every visa; exact/title matches must narrow before offering disambiguation.
- Two of the test:cli-catalog failures are stale expectations (employee write-tool perimeter pin from Task #445, raw opp delete in client-meeting-probe) — pre-existing, tracked as a follow-up.
- Mobile ResultCards: external https links (outlookDraftLink/href) render via ExternalLinkRow; outlookDraftLink is in SKIP_KEYS so it never shows as a raw-URL grid cell.
