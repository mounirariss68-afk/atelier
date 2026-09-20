---
name: Atelier agent prompt overrides
description: Non-obvious identity and manifest rules for governed agent prompt editing.
---

Store organisation prompt overrides against the canonical runtime-registry agent ID (`ag_*`), while accepting the bare IDs used by runner code. Resolve filesystem defaults from the registry prompt reference because some finance agents do not use the conventional directory layout.

**Why:** Profile routes and persisted runs expose canonical IDs, but runner call sites historically load prompts by bare logical IDs. Treating those as different keys makes saved edits appear successful while later executions continue using the default. Prompt-file changes also alter generated CRM manifest hashes and will block API startup until the manifest is regenerated.

**How to apply:** Any new prompt read/write or execution path must pass through the effective resolver rather than querying overrides or reading files directly. After adding or changing a registered prompt file, regenerate and check the CRM agent manifest before restarting the API.