---
name: Atelier POV revision loop invariants
description: How the POV outline→draft→revise lifecycle and its status guards fit together.
---

The POV lifecycle is status-driven: `outline` → `drafted` → `approved`, with
`revise` looping back to `drafted`.

- **Approving the *outline* run (`ag_pov_author`) must NOT flip status to
  "approved".** Only approving the *draft* run (`ag_pov_draft`) does.
  **Why:** the draft route guards on `status === "outline"`; if outline approval
  set status to "approved", the very draft it authorised would be rejected. This
  was a real bug — the decision route used to flip both pov_author and pov_draft.

- **Draft route is single-shot per outline approval:** it 409s unless
  `status === "outline"`. Replays can't mint versions — reviewers use
  `POST /povs/:id/revise` (feedback required) which always creates a new numbered
  version, keeps priors, advances `currentVersionId`, and resets status to
  `drafted` (needs re-approval).

- **Outline is frozen after a draft exists:** PATCH outline and
  `outline/regenerate` both 409 unless `status === "outline"`. Title/objective
  are editable at any status.

- **PDF route (`/opportunities/:oppId/pov.pdf`) honours `?povId=` and
  `?versionId=`** — export the on-screen POV/version, not just the newest POV.
  UI must pass both. It is a raw route (NOT in openapi.yaml), so no codegen.

- **Rendered draft HTML is sanitized client-side with DOMPurify** in PovTab
  before `dangerouslySetInnerHTML`.

- Offline probe: `tests/crm/pov-revision-probe.ts` (validation step
  `pov-revision`). Stub Anthropic distinguishes draft from outline by the
  `"Phase B (sections)"` directive substring in the request body.
