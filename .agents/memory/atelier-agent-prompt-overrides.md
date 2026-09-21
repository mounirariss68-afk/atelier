---
name: Atelier agent prompt overrides
description: Non-obvious identity and manifest rules for governed agent prompt editing.
---

Store organisation prompt overrides under one canonical registry identity, even when callers use legacy aliases.

**Why:** Different identifiers at write and execution time make a saved edit appear successful while later executions continue using the default.

**How to apply:** Normalize aliases at every read/write boundary and use the shared effective-prompt resolver for execution.