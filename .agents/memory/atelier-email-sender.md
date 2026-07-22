---
name: Per-actor email From resolution
description: How sendEmail decides the From/Reply-To and what new call sites must do
---

Rule: every `sendEmail` call must pass `sender: { actor: { name, email } } | "system"` — no silent default. Resolution lives in `resolveSender()`:
- actor email on a Resend-verified domain (live `GET /domains`, 10-min cache, `RESEND_API_BASE_URL` overridable for stub tests) → From is the actor themselves;
- otherwise From stays branded as "Name · Cognirise <branded>" with `reply_to` = actor's real address;
- `"system"` = branded From (schedulers, public-site routes, sync notifications).

**Why:** clients should see the human who acted (any verified-domain user, not just founders); Resend rejects unverified From domains, so gmail-style logins must fall back with Reply-To.

**How to apply:** new email surfaces must decide actor vs system explicitly (EA acting-for passes the represented partner). E-sign invites derive the actor from the request row's `createdBy` user; their no-branded-From guard is bypassed only when the creator is a verified-domain sender. Non-ASCII display names are RFC 2047 B-encoded by `formatFromHeader` (the "·" separator makes fallback names always encoded). Delivery semantics unchanged: only ok+via:"resend" = sent.
