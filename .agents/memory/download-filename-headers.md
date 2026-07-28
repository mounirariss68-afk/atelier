---
name: Download filename headers
description: Header-safe Content-Disposition for user-derived filenames (Turkish names crashed downloads)
---

Rule: every `Content-Disposition` built from user-derived text (person names, uploaded file names, document titles) must go through the shared header helper in the api-server lib (`contentDispositionFilename`), which emits an ASCII fallback `filename=` plus RFC 5987 `filename*=UTF-8''…`.

**Why:** Node rejects header values with chars outside latin1 (`ERR_INVALID_CHAR`); a Turkish "ş" in a business-card filename turned the download into a 500 HTML error page. Ad-hoc sanitizers varied per route (some only stripped quotes) and several were vulnerable.

**How to apply:** when adding any new binary download endpoint, never template a raw name into the header; call the helper. JS `\w` regex is ASCII-only so `[^\w.\- ]`-style sanitizers are safe but lose the real name — prefer the helper's dual form. Zip entry names can stay UTF-8. Regression check lives in the roster-card test (Turkish-named fixture).
