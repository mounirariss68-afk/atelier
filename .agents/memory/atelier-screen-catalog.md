---
name: Screen catalog & find_screen
description: Durable rules for the generated screen catalog behind the assistant's "where do I find X?" answers.
---

- The screen catalog the chat assistant answers navigation questions from is GENERATED from the web app's nav definitions — never hand-edit it; regenerate and rely on the `--check` drift guard.
- **Why:** the assistant returns real `navigateTo` links from it; a stale or hand-edited catalog sends users to dead or forbidden screens.
- **How to apply:** any nav change (lens sections, new top-level page, role gating) → re-run the generator. Role-gated Me tabs are defined in the web menu AND mirrored in the generator — the drift guard does NOT catch divergence in those role rules, so change both together (a follow-up task proposes centralizing them).
- Persona safety comes from per-screen role slices in the catalog, not the capability gate: self-only personas only ever hear about Me-lens screens, alliance partners only about the partner portal. Record-scoped workspaces answer with location text and no link.
