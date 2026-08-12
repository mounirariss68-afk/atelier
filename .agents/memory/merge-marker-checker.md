---
name: Merge-resolution marker checker
description: continueMergeResolution substring-matches the 7-equals marker — decorative comment separators trip it
---

The merge-resolution driver's marker check is a plain substring scan for the 7-equals conflict marker (not line-anchored). Files with decorative comment rules made of long `=` runs fail the check even after all real conflict markers are resolved — including memory notes that quote the marker literally.

**Why:** hit during a rebase of the atelier-cli index (2026-08-12); grep showed zero real markers but the driver kept reporting `markers_remain`.

**How to apply:** if `continueMergeResolution` reports leftover markers you can't find at line starts, grep for runs of 7+ `=` anywhere and rewrite them (comments to dashes, prose to "7-equals"), then retry.

Caution: rewriting the separators mid-rebase makes every later commit touching that file conflict cosmetically (dash-run lengths). When that happens the sides differ only in separators — take the incoming side wholesale after diffing.
