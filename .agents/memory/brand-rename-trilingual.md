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

## Project-level naming state (this repo)
The content library is now `@workspace/cognirise-content` (folder `lib/cognirise-content/`); the old
`@workspace/maven-content` / `lib/maven-content/` are fully gone — imports, tsconfig refs, package deps,
post-merge.sh filter, and pnpm-lock all updated in lockstep. The web artifact's registered **title** is
now "Cognirise" but its package name `@workspace/maven-ai` and folder `artifacts/maven-ai/` are
DELIBERATELY KEPT (renaming the root artifact dir/preview path would break links — out of scope).
So `rg maven-ai` still legitimately hits the package/dir tokens; only `maven-content` was eliminated.
Generated files (`lib/api-zod`, `lib/api-client-react`) are regenerated from `lib/api-spec/openapi.yaml`
via `pnpm --filter @workspace/api-spec run codegen` — edit the spec, never the generated `api.ts`.
