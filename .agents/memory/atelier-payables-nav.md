---
name: Payables navigation & action panel
description: How the procure-to-pay (payables) navigation is grouped and why the "Needs your action" panel reuses the unified approvals inbox.
---

- The payables landing and its tab strip both derive from ONE grouped-tab structure in the payables page module — never re-add a payables entry to the generic finance-sections registry, or landing and tabs drift apart.
- The "Needs your action" panel deliberately reuses the unified finance approvals inbox (leadership-gated) filtered to payables kinds — no separate payables inbox endpoint.
- **Why:** one aggregation source means the queue never forks; the inbox already enforces role gates and builds deep-link hrefs.
- **How to apply:** a new payables approval surface should add its kind to the shared inbox loader and to the panel's payables-kind filter — never a parallel aggregation.
- 3-way-match exceptions are intentionally absent from the panel: the PO / 3-way-match surfaces and data were retired earlier (stub sweep), and the old stalled-approvals dashboard read is a stub returning empty — don't wire it up as if it were live.
- The account-page "procurement" tab is labelled "Supplier registration" (vendor-registration research), intentionally distinct from Finance AP/P2P; the tab key stays stable for deep links.
