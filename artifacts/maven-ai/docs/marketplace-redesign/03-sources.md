# Sources & Benchmarks Appendix

Every KPI / benchmark cited in the per-tool spec files in this folder
is footnoted to one of the sources listed here. The build task should
preserve these citations as small footnote chips next to each KPI
number on the detail page (and on the demo's KPIs tab).

These are public, citable references. The implementation must NOT
fabricate KPI numbers or invent vendor-quoted percentages. Where
exact numbers cannot be sourced, ranges are used and labelled
"illustrative · advisory benchmark" in the UI.

## Industry & analyst reports

- **S1.** McKinsey & Company, *The state of AI in 2024: Gen AI
  adoption spikes and starts to generate value* (May 2024). Used for
  enterprise gen-AI value capture and time-to-value benchmarks.
- **S2.** McKinsey & Company, *The economic potential of generative
  AI: The next productivity frontier* (June 2023). Used for function-
  level productivity gains in customer operations, knowledge work,
  marketing, and software engineering.
- **S3.** Gartner, *Magic Quadrant for AIOps Platforms* (latest
  edition). Used for incident-mean-time-to-resolve and noise-
  reduction benchmarks.
- **S4.** Gartner, *Hype Cycle for Sourcing & Procurement* (latest).
  Used for procurement savings and cycle-time benchmarks.
- **S5.** Forrester, *The Total Economic Impact™ of Salesforce
  Einstein for Service* (latest). Used for contact deflection and
  handle-time benchmarks.
- **S6.** Boston Consulting Group, *Where's the Value in AI?* (2023).
  Used for transformation programme value-realisation and leakage
  benchmarks.
- **S7.** Bain & Company, *Procurement Excellence: Negotiation*
  (2023). Used for negotiation-prep cycle-time and saving-rate
  benchmarks.

## Vendor case studies & published references

- **V1.** ServiceNow, *Now Assist for ITOM customer outcomes* (NOW
  customer pages). Used for AIOps incident-triage benchmarks.
- **V2.** Salesforce, *Einstein Service customer outcomes* (Salesforce
  customer story library). Used for customer-care deflection
  benchmarks.
- **V3.** Glean, *Customer outcomes & ROI* (Glean published
  references). Used for enterprise-search time-savings benchmarks.
- **V4.** ServiceNow, *Now Assist for IRM customer outcomes*
  (regulated-industry pages). Used for compliance-pack-assembly
  benchmarks.
- **V5.** Coupa, *Spend Guard outcomes* (Coupa customer pages). Used
  for spend-leakage detection benchmarks.

## Regulator & GCC government publications

- **R1.** Saudi Central Bank (SAMA), *Cyber Security Framework* and
  *Counter-Fraud Framework* (latest published versions). Used for
  obligation-mapping scope, evidence-age expectations, and
  inspection-pack contents.
- **R2.** UAE *Personal Data Protection Law* (PDPL Federal Decree-
  Law No. 45/2021) and the *UAE AI Charter*. Used for data-residency
  and AI-governance obligations in the Sovereign Data Steward.
- **R3.** UAE Telecommunications and Digital Government Regulatory
  Authority (TDRA), *Service Continuity & Major Outage Notification*
  guidelines. Used for the regulator-notification clock in Network
  Ops War Room.
- **R4.** Communications, Space and Technology Commission (CST,
  Saudi Arabia), *Major incident reporting requirements*. Used as
  the regulator analogue for the Saudi market.
- **R5.** SDAIA / NDMO, *Saudi National Data Management Office data
  classification* guidance. Used for sovereign data classification
  in the Steward.
- **R6.** GCC ministries' open tender portals (Etimad — Saudi Arabia;
  Tejari / DGS — UAE) for typical RFP page-counts, response
  windows, and qualification structures used in the Tender
  Response Studio.

## Cognirise advisory benchmarks

Where no public number exists, Cognirise uses internal advisory
benchmarks from its own engagements with GCC operators, banks, and
ministries. These are labelled "Cognirise advisory benchmark" inline so
the visitor can see they are internal estimates, not vendor claims.

- **M1.** Cognirise advisory benchmark, *GCC tender response cycle
  time and win-rate baselines* (internal; aggregated across 12
  operator and ministry engagements, 2023–2025).
- **M2.** Cognirise advisory benchmark, *Programme leakage and value
  realisation in GCC megaprojects* (internal; aggregated across 8
  programmes, 2022–2025).
- **M3.** Cognirise advisory benchmark, *Citizen-services bilingual
  case-mix and dialect coverage* (internal; aggregated across 5
  ministry contact-centre engagements, 2023–2025).

## Style for citing in the per-tool specs

- KPIs cite their source inline like `[S1]`, `[V2]`, `[R1]`.
- Multiple sources are joined: `[S2, V3]`.
- Cognirise advisory benchmarks are cited like `[M1]` and the UI must
  surface them with the "Cognirise advisory benchmark" label.
- Where a KPI is illustrative, the value is shown as a range
  (e.g. `25–35%`) and chipped with "illustrative".
