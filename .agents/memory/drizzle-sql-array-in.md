---
name: Drizzle sql`` array interpolation wraps in parens
description: How JS arrays expand inside drizzle's sql`` template, and why ANY(array) breaks but IN array works.
---

When you interpolate a JS array into drizzle-orm's `sql\`\`` template (raw
`db.execute`/`sql` fragments), drizzle expands it to a **parenthesized,
comma-separated parameter list**: `${["a","b","c"]}` → `($1, $2, $3)` — the
parens are added by drizzle, not by you.

Consequences:
- `col = ANY(${arr})` renders `ANY(($1,$2,$3))` → Postgres reads the inner
  parens as a row/tuple and errors ("op ANY requires array"). **Broken.**
- `col IN (${arr})` renders `IN (($1,$2,$3))` → double parens, also **broken.**
- `col IN ${arr}` (NO literal parens) renders `IN ($1,$2,$3)` → **correct.**

**Why:** drizzle already supplies the surrounding parens for an array, so add
none of your own and use `IN`, not `ANY`. (`ANY` needs a single array param,
which drizzle's array expansion does not produce.)

**How to apply:** in any atelier-cli retrieval / ACL `sql\`\`` fragment that
filters on a JS string array (engagement ids, account ids, attachment ids),
write `column IN ${idsArray}`. Always guard against an empty array first
(`arr.length > 0 ? sql\`col IN ${arr}\` : sql\`false\``) because `IN ()` is
invalid SQL. This bit the chunk-retrieval ACL path (only exercised by
non-privileged personas, so it slipped past privileged-persona tests).
