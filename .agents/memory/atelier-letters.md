---
name: Employment/salary letters stack
description: Letter templates, PDF RTL rendering, entity letter-signing overlay, and prod re-run needs
---
- Letter-signing assets (signatoryName/Title/Email, signature/stamp fileRefs) live as overlay `payload.letterSigning[entityId]` on the published firm-profile row — survives registry-replace PUT; `listSigningEntities` merges the overlay. New registry consumers get them for free.
- Arabic PDF (pdfkit + Noto Naskh + `features:["rtla"]`): guard with `hasArabic()` — rtla does NOT flip Arabic-free strings, so pure-Latin lines must skip fixRtlRuns and render LTR with the Latin font. Embedded LTR runs pre-reversed via fixRtlRuns; run regex must include Latin-Extended (Turkish ş/ğ). Avoid parentheses in Arabic strings (brackets don't mirror).
- Absolutely-positioned footers paginate onto a phantom page under Arabic line metrics — shrink doc bottom margin (18) instead of fighting y math.
- Entity resolution for an employee's letters: payroll legalEntityId → unambiguous name-match on roster employingEntity → default entity; ambiguity falls to default WITH a flag surfaced in confirm, never a silent guess.
- Letter-signing seed (Dubai entity signatory + signature/stamp assets) must be re-run on prod at go-live — DB data never merges from task envs.
- Digital issuance hard-requires configured signatory + signature AND stamp assets (never issue an unsigned letter described as signed); letter assets accept PNG/JPEG only — PDFKit cannot embed WebP.
- Issued letters are person-doc kind `employment_letter`, deliberately visible in /me/documents.
