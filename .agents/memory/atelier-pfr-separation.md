---
name: Partner-firm contact separation
description: PFR (partner_firm_resource) rows are presentation-separated from internal workers — rules for lists, compliance, person page.
---

Partner-firm contacts are promoted to real roster rows (`atelierPartnerFirmResources`, ids `pfr_pfc_*`) by design — never delete them; separation is presentation-only.

**The rules:**
- `listPersons`/`GET /roster/people` accepts `workerType=internal` (employees+contractors). Default stays `all` so search, pickers, and chat keep finding PFRs (Task #250 concern). Internal-workforce surfaces (People directory, dashboards, composition analytics) must request `internal`.
- `/roster/compliance` classifies each record from the RESOLVED person's workerType (never the stored/request `personType`, which can be blank/stale); POST derives personType server-side when personId is set. Worker `buckets` vs `partnerBuckets` roll up separately.
- Person page: PFR hides timesheet/skills/learning/performance/conflicts tabs AND normalizes direct deep-link URLs to Profile (`effectiveTab`); comp/banking card replaced by a firm-level commercials note. Hiding a tab from nav is not enough — gate the content dispatch too.
- Partner contacts' home is Partners → Co-deliver (`/partners/co-deliver`); cards link back to the person page.

**Why:** BGTS staff appeared as internal workers with timesheet/compliance framing; partners never do timesheets.

**How to apply:** any new roster-union consumer must decide explicitly: internal-only (`workerType=internal`) or all-with-badging. Never present PFRs with worker framing.
