---
name: Merge verifier flags "=======" banner comments
description: continueMergeResolution's marker check is a naive substring scan; decorative // ===== banners block rebase completion.
---

The merge-resolution verifier scans previously-conflicted files for `<<<<<<<` / `=======` / `>>>>>>>` as **substrings**, so decorative comment banners like `// =====================` are false positives that keep `continueMergeResolution` failing with "markers remain" even after all real conflicts are resolved.

**Why:** hit during a rebase of the api-server atelier-cli module (2026-08-12); real conflict was gone but 26 banner lines kept the check red.

**How to apply:** if `continueMergeResolution` reports markers remain but `grep '^<<<<<<<\|^>>>>>>>\|^======='` finds nothing, look for 7+ consecutive `=` anywhere in the file and rewrite those banners to dashes. Avoid writing new `=====`-style banners in code.
