---
name: Atelier merchant recognition
description: Layered merchant matcher invariants and wallet parse-endpoint conventions
---
- Match tiers in order: org memory alias → global merchant DB (token-index fuzzy, warmed at boot — expect a "[TokenMatcher] Index built" log seconds AFTER "Server listening") → keyword rules → AI enrich batch.
- Guards must stay ahead of fuzzy: <4 chars, >60% digits, transfer markers, ambiguous gap (≤0.05 and <0.85). Unmatched text (normalized ≥2 chars) is logged for the leadership admin panel.
- Wallet parse/enrich/unmatched endpoints are deliberately NOT in openapi.yaml; web UI calls them with raw fetch (same convention as account agent routes). Enrich is 202 + poll `/enrich/:runId`; 409 if a run is already in progress.
- **Why:** binary-upload + long-LLM shapes don't fit the orval codegen contract, and boot warmup avoids a full-table scan on first parse.
- **How to apply:** new merchant sources go in as a tier in matcher.ts, not ad-hoc lookups; don't add these routes to the spec or "fix" the missing codegen hooks.
