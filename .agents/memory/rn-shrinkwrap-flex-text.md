---
name: RN shrink-wrapped bubble collapses flex:1 text
description: Why chat bubble text wrapped one char per line on mobile and the width fix
---
In React Native, a parent with `alignItems:"flex-start"` (or flex-end) shrink-wraps its child to intrinsic width. If the child contains rows with a `flex:1` Text, the intrinsic width is ~0, so streamed text wraps one character per line (worst mid-stream, both LTR/RTL).

**Why:** hit on the mobile Chat tab assistant bubble; `maxWidth:"92%"` does NOT bound it (maxWidth caps but doesn't stretch).

**How to apply:** give the wrapping bubble a fixed `width:"92%"` (or alignSelf:"stretch") instead of maxWidth whenever text rows use flex:1 inside an alignItems-aligned parent.
