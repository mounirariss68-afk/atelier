---
name: E-sign extra date/initials fields
description: Contract for optional per-signer date/initials boxes on signature requests
---
The e-sign create body has optional `extraFields` ({signerIndex 0-based, type date|initials, page,x,y,w,h}, max 40) alongside the one-per-signer `placements`.
**Why:** real agreements need date-signed + per-page initials boxes; DocuSeal supports field types "date" and "initials" and roles must stay "Signer N".
**How to apply:** field names in the DocuSeal template must be unique ("Date signed 1", "Initials 2.2"); extra fields are recorded only in the send audit payload (not requestShape); frontend prunes entries whose signerIndex no longer exists and omits the key when empty so the baseline flow is byte-identical.
