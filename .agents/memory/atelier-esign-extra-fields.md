---
name: E-sign extra date/initials fields
description: Contract for optional per-signer date/initials boxes on signature requests
---
The e-sign create body has optional `extraFields` ({signerIndex 0-based, type date|initials, page,x,y,w,h}, max 40) alongside the one-per-signer `placements`. The lib layer additionally supports `type:"text"` with an optional `label` (contract send path uses it for the counterparty's fill-in boxes, e.g. printed name/title); the REST route zod deliberately still allows only date|initials.
**Why:** real agreements need date-signed + per-page initials boxes and counterparty self-completed fields; DocuSeal supports field types "date"/"initials"/"text" and roles must stay "Signer N".
**How to apply:** field names in the DocuSeal template must be unique ("Date signed 1", "Initials 2.2", "<label> 1"); the contract send path maps every second_party template field — date → date box for every signer, non-date → labelled text box on the COUNTERPARTY signer only (matched by contact/person email, fallback signer 0); extra fields are recorded only in the send audit payload (not requestShape); frontend prunes entries whose signerIndex no longer exists and omits the key when empty so the baseline flow is byte-identical.
