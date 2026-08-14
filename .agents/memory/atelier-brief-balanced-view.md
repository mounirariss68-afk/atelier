---
name: Account brief balanced view
description: Single "Our view" presentation of the Cartographer stress-test across all brief surfaces
---
The rule: reader-facing brief surfaces present ONE synthesized opinion — never the pre-stress-test hypothesis (or partner-entered hypothesis) in parallel with the stress-test attack or the revised view. Presentation shape: "Our view" + up to 4 "What could change our view" caveats + a confidence indicator from assumption grounding.

**Why:** partners read the raw stress-test blob as two dueling expert opinions (2026-08 product decision). The pre-mortem itself stays: Cartographer prompt and stored data shape are unchanged, so old briefs must degrade gracefully (view-only, or caveats-only with no headline).

**How to apply:** distill via the shared `distillBriefView()` helper (a server copy and a deliberately mirrored web copy exist — keep them in lockstep; a parity probe guards them). New brief-rendering surfaces must go through it rather than reading stress-test fields directly, and must render when EITHER the view or caveats exist.
