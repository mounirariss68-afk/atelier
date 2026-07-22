# HR / People Module — Feature Backlog

Task #509 removed every People-module section that had no real backend (the
"stub policy"): a tab that renders an empty promise erodes trust more than a
missing tab. Nothing was silently dropped — each removed item is recorded here
with what it was meant to do, why it was removed, and what a real
implementation needs. Former nav locations are given so future work can
restore them in place.

## Retain (entire section — was `/people/retain`, 4 tabs)
| Tab | Intended purpose | Needs for a real implementation |
|---|---|---|
| Engagement surveys | Periodic pulse/engagement surveys with trend lines | Survey schema + distribution/collection flow, anonymity rules, trend aggregation API |
| Flight risk | Risk scoring of likely leavers (tenure, comp, engagement signals) | A scoring model over real tenure/comp/engagement data + explainability + HR-only ACL |
| Internal mobility | Open internal moves and transfer pipeline | Internal posting schema, application flow, approval chain |
| Stay interviews | Structured stay-interview log with themes | Interview log schema, themes taxonomy, HR-only ACL |

Removed because: no backend at all; the page rendered seeded placeholders.
Was in the primary People lifecycle strip (lens nav) — restore there.

## Reward (tabs removed from `/people/reward`)
| Tab | Intended purpose | Needs |
|---|---|---|
| Comp bands | Salary band definitions per level/market | Band schema keyed to the titles registry, market data source, finance/HR ACL |
| Comp review | Annual comp review cycle workflow | Cycle schema, manager proposals, calibration + approval chain, payroll handoff |
| Total rewards | Per-person total-reward statements | Aggregation over pay + benefits + bonus data (pay hub is the only live source today) |
| Recognition | Peer/manager recognition feed | Recognition schema, notifications, feed API |

Removed because: no backend; only the Pay admin flow (Reward → Pay) is real.

## Perform (tabs removed from `/people/perform`)
| Tab | Intended purpose | Needs |
|---|---|---|
| Calibration | Cross-manager rating calibration sessions | Calibration session schema, rating distribution views, partner ACL |
| Succession | Succession plans for key roles | Role criticality registry, successor nominations, readiness tracking |

Goals / check-ins / reviews remain — they are real.

## Develop (tabs removed from `/people/develop`)
| Tab | Intended purpose | Needs |
|---|---|---|
| Learning catalogue | Firm-wide course/training catalogue | Course schema + content source, audience targeting |
| My learning | Self-serve learning transcript (org lens duplicate of Me-lens) | The Me-lens `/me/learning` already exists; an org-lens variant needs per-person ACL |
| Mentoring | Mentor/mentee matching and tracking | Matching schema, pairing workflow |
| Skill gaps | Gap analysis vs role expectations | Role skill profiles keyed to the titles registry + assessment data |

Training records and certifications remain — they are real.

## Attract (tabs removed from `/people/attract`)
| Tab | Intended purpose | Needs |
|---|---|---|
| Employer brand | Careers-page/brand asset metrics | Analytics source (site metrics), content management |
| Sourcing | Sourcing channel performance (agencies, boards, referral mix) | Channel taxonomy + per-channel candidate attribution in the hire pipeline |

Workforce plan was implemented minimally (open roles per practice from Hire
data); Referrals remain real. "Candidate CRM" label replaced with "Open
Candidates".

## Offboard (tabs removed from `/people/offboard`)
| Tab | Intended purpose | Needs |
|---|---|---|
| Knowledge | Knowledge-transfer checklist per leaver (had hardcoded dummy items — deleted) | KT item schema bound to offboarding steps, owner assignment |
| Access | Access-revocation dashboard view | A read view over engagement_access + credential state (data exists; needs a real aggregation endpoint) |
| Exit | Exit interview capture + themes | Interview schema, HR-only ACL, theme roll-up |

The offboarding sequence itself (steps, reassignment gate, audit pack) remains.

## Org (entire section — was `/people/org`; org chart lives elsewhere)
| Tab | Intended purpose | Needs |
|---|---|---|
| Org units | Practice/department unit registry | Unit schema + person assignment, reorg history |
| Role library | Role definitions with expectations per level | Role schema keyed to the titles registry (now exists — good foundation) |

`/people/org` now redirects to People. The interactive org chart remains on
the person/roster surfaces.

## Approvals (lanes removed from `/people/approvals`)
| Lane | Intended purpose | Needs |
|---|---|---|
| Promotions | Promotion approval queue | Promotion request schema, comp implications, partner approval chain |
| Offers | Offer approval queue | Offer approval states in the hire pipeline (offers exist; approval chain does not) |

Real approval lanes (expenses etc.) remain.

## People dashboard (panels removed from `/people`)
| Panel | Intended purpose | Needs |
|---|---|---|
| Lifecycle funnel | Attract→offboard conversion funnel | Real per-stage counts over hire + roster lifecycle data |
| Performance & development | Review/goal completion roll-up | Aggregation endpoints over Perform data |
| Retention & engagement | Attrition and engagement trend panel | Depends on the Retain section backends above |
| Compensation & rewards | Comp spend/band position roll-up | Depends on comp bands + payroll aggregation |
| Learning & compliance | Training/compliance completion roll-up | Aggregation over training + compliance records (data partially exists) |
| Action queue | Cross-module HR to-do roll-up | Real task sources per module (was fully seeded) |

KPI strip and workforce composition remain, now on real roster data only.

## Person page (tabs removed from the person detail view)
| Tab | Intended purpose | Needs |
|---|---|---|
| Compensation | Per-person comp history | Pay data stays on Reward → Pay admin (ACL-heavy); a person-tab needs the same gates |
| Succession | Person's succession/readiness view | Depends on Perform succession backend |

Performance, Learning and Time tabs were instead wired to the real
Perform/Develop/timesheet data.
