---
name: Brand rename in trilingual (EN/AR/TR) content
description: Gotchas when find/replacing a brand name across English, Arabic, and Turkish content in this repo
---

# Brand renames must cover transliterations and grammar, not just the Latin name

When severing/renaming a brand across this codebase's trilingual content, a case-insensitive
Latin search (`rg -i 'maven'`) MISSES non-Latin forms. You must separately scan for:

- **Arabic transliteration** — e.g. "Maven" appears as `مافن` and "Maven Insights" as `مافن إنسايتس`.
  Convention here: keep the brand in **Latin script inside Arabic text** (e.g. `وجهة نظر Cognirise`),
  matching how About.tsx already writes `عن Cognirise`. Do NOT transliterate the new brand.
- **All-caps** Latin (`MAVEN`, `MAVEN AI`) in display/video scenes — `rg 'Maven'` is case-sensitive and won't match.
- **Turkish genitive suffix** — a consonant-final brand ("Maven") takes `'in`/`'ın`; a vowel-final
  brand ("Cognirise") needs the buffer `n`: `Cognirise'nin`. Blanket replace produces wrong `Cognirise'ın`/`Cognirise'in`; fix to `Cognirise'nin`.

**Why:** the first cleanse pass looked "complete" via Latin search but left Arabic `مافن` in 4 files
and structural "Maven Insights" framing. Always run `rg 'مافن'` (and any other script in use) as a separate verification pass.

**How to apply:** run `Maven AI`→brand BEFORE `Maven`→brand (else you get "Brand AI"); handle two-word
entity names ("Maven Insights", `مافن إنسايتس`) as manual rewrites first so they don't become "Brand Insights".

## Excluded-from-rename identifiers (this repo)
Package names `@workspace/maven-ai` / `@workspace/maven-content`, directories `artifacts/maven-ai/` /
`lib/maven-content/`, the `maven-ai` repo/dir token in seed data, preview path, workflow IDs, and
path strings in tsconfig*/pnpm-lock/post-merge.sh are renamed separately by the user — leave them.
Generated files (`lib/api-zod`, `lib/api-client-react`) are regenerated from `lib/api-spec/openapi.yaml`
via `pnpm --filter @workspace/api-spec run codegen` — edit the spec, never the generated `api.ts`.
