---
name: Credential-bearing link routes
description: Any route returning activation/reset URLs must use trustedRequestOrigin + reject untrusted explicit Origins
---

- Rule: any cookie-authenticated route whose JSON response carries a credential-bearing link (activation/reset token URL) must (1) build the URL via `trustedRequestOrigin(req)` (lib/auth/trusted-origin), never raw `req.headers.origin`, and (2) 403 outright when an explicit Origin header doesn't match the trusted origin — CORS reflects arbitrary origins with credentials, so answering a hostile origin leaks the token (account takeover).
- **Why:** completion review rejected the Task-885 partner reset-link route for exactly this exfiltration path; auth routes already follow the pattern.
- **How to apply:** copy the guard from the partner reset-link route in partnerPortalRoutes; note the pre-existing provision route still uses raw Origin (candidate hardening).
- Partner-portal admin login routes are deliberately NOT in openapi.yaml (raw fetch in PortalLoginsPanel, Task #873 design) — reviewers may flag this; it's consistent by design.
