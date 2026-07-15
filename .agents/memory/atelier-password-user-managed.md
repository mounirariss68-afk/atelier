---
name: Atelier password user_managed flag
description: Boot seed vs user-changed passwords on atelier_auth_credentials
---
Rule: `atelier_auth_credentials.user_managed=true` means the partner set their own password; the boot seed must skip such rows (only repair the userId link) and must never rewrite the hash.

**Why:** The seed runs on every boot (dev AND prod) and previously force-reset any hash that didn't match the fixed seeded password — it would silently undo a user's password change on restart.

**How to apply:** Any new credential write surface (admin reset, forgot-password, etc.) must decide the flag deliberately: user-chosen secrets set it true; an admin/temporary reset that should be re-seedable or force-changed sets it false (or adds its own mechanism). Change-password also revokes all *other* sessions via `revokeOtherSessions` — keep that on any future credential rotation path.
