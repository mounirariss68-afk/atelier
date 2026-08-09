---
name: National ID front/back sides
description: Person-document back-side model — which kinds accept backs, what "sides" means, where side-aware downloads live.
---

- Back-side columns (backFileRef etc.) exist on atelier_person_documents but are only VALID for kind `national_id`; every other kind must reject `fileBack` / `side=back` (400).
- **Why:** compliance needs both faces of an ID card; other doc kinds keep the single-file contract to avoid ambiguous "sides" semantics.
- `sides` in the wire shape is national_id-only: `front_back` | `combined` (single PDF front counts as complete) | `front_only` (legacy, back attachable later via replace route `side=back`) | `none`. Other kinds get `sides: null`.
- **How to apply:** any new download/upload surface for person docs must be side-aware for national_id (owner /me routes take `?side=back` / body `side`; HR signed roster download appends `&side=back` — side is NOT in the HMAC payload, and the persona cookie is still required alongside the token).
- Probe: `artifacts/api-server/scripts/id-back-probe.ts` (self-cleaning, boots app.listen(0), NODE_ENV=test persona cookie).
- Clients must never open the download route via bare anchors/Linking: the 404 `{error:"no-file"|"file-missing"}` body renders as raw JSON (web) or gets shared as a JSON file (expo downloadAsync writes error bodies — check `result.status`). Web fetches then blob-opens; mobile web HEAD-probes first; a 404 shows a friendly "back side missing — upload it" message + refetch (stale hasBackFile flags).
- Dev and prod share the object-storage bucket; prod DB is agent-read-only, so a prod row missing back_file_ref is repaired by re-uploading through the published app, not by data transfer.
