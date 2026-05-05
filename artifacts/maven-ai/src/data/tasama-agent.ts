// Tasama Payroll Intelligence Hub — agent-output generators.
//
// Mirrors arcelik-agent.ts in shape. Pulls live data via the snapshot in
// useTasamaData, then derives recommendations / alerts / tasks / playbooks /
// performance scorecards / decision logs / process instances / simulator
// recommendations / decision analytics / per-client insights that the three
// demo experiences (Agent Operations, Client Portal, Manager Dashboard)
// render.
//
// Narrative now: April 2026 (KSA fiscal year mid-Q2).

import type {
  TasamaClient,
  TasamaEmployee,
  PayrollRun,
  ServiceRequest,
  RegulatoryCalendarEntry,
  AgentPerformanceRecord,
  TasamaAgentId,
  PayrollRole,
  PayrollRecommendation,
  ReasoningStep,
  Severity,
  RecommendationStatus,
  TaskStatus,
  AgentPerformanceScore,
  DecisionAnalytics,
  ClientAgentInsight,
  SimulatorRecommendation,
  ProcessStep,
  EmployeeProcess,
} from "./tasama-seed";
import {
  computeEosb,
  computeGosi,
  formatSAR,
  getAgentName,
  TASAMA_AGENT_IDS,
  type Lang,
} from "./tasama-seed";
import { getTasamaDataSnapshot, isTasamaDataReady, type TasamaData } from "@/hooks/useTasamaData";

// Re-export shared types from tasama-seed so existing call-sites can keep
// importing them from "@/data/tasama-agent".
export type {
  PayrollRole,
  Severity,
  RecommendationStatus,
  TaskStatus,
  ReasoningStep,
  PayrollRecommendation,
  AgentPerformanceScore,
  DecisionAnalytics,
  ClientAgentInsight,
  SimulatorRecommendation,
  ProcessStep,
  EmployeeProcess,
} from "./tasama-seed";

// ─── Local types not in tasama-seed ──────────────────────────────────────

export type PlaybookStatus = "triggered" | "running" | "awaiting-approval" | "completed";

export interface PayrollTask {
  id: string;
  title: string;
  description: string;
  assignee: string;
  assigneeRole: PayrollRole;
  priority: Severity;
  deadline: string;
  status: TaskStatus;
  linkedRecommendation?: string;
  createdAt: string;
}

export interface PayrollAlert {
  id: string;
  type: string;
  title: string;
  detail: string;
  severity: Severity;
  category: string;
  timestamp: string;
  actionUrl?: string;
}

export interface PlaybookStep {
  agent: TasamaAgentId | "human-checkpoint";
  action: string;
  status: "completed" | "running" | "pending";
  output?: string;
}

export interface PayrollPlaybook {
  id: string;
  name: string;
  trigger: string;
  status: PlaybookStatus;
  steps: PlaybookStep[];
  startedAt: string;
  linkedRecommendation?: string;
}

export interface PayrollActivityEntry {
  id: string;
  agent: TasamaAgentId;
  agentName: string;
  action: string;
  detail: string;
  timestamp: string;
  type:
    | "extraction"
    | "calculation"
    | "filing"
    | "transfer"
    | "monitoring"
    | "communication"
    | "audit"
    | "orchestration";
}

export type DecisionType = "approved" | "rejected" | "modified";

export interface PayrollDecisionLog {
  id: string;
  recommendationId: string;
  recommendationTitle: string;
  decisionType: DecisionType;
  decidedBy: string;
  role: PayrollRole;
  timestamp: string;
  rationale: string;
  modificationNote?: string;
  simulatedOutcome: {
    cost: string;
    compliance: string;
    sla: string;
    timeframe: string;
  };
}

// ─── Time anchors (April 2026 narrative) ────────────────────────────────

const NOW = new Date("2026-04-26T09:00:00Z");
const isoDaysAgo = (d: number) => {
  const dt = new Date(NOW);
  dt.setDate(dt.getDate() - d);
  return dt.toISOString();
};
const isoHoursAgo = (h: number) => {
  const dt = new Date(NOW);
  dt.setHours(dt.getHours() - h);
  return dt.toISOString();
};
const isoDaysFromNow = (d: number) => {
  const dt = new Date(NOW);
  dt.setDate(dt.getDate() + d);
  return dt.toISOString().slice(0, 10);
};

const EMPTY_DATA: TasamaData = {
  clients: [],
  employees: [],
  salaryComponents: [],
  payrollRuns: [],
  payslips: [],
  documents: [],
  serviceRequests: [],
  gosiRecords: [],
  leaveBalances: [],
  eosbProvisions: [],
  regulatoryCalendar: [],
  agentPerformance: [],
};

function safeData(): TasamaData {
  return isTasamaDataReady() ? getTasamaDataSnapshot() : EMPTY_DATA;
}

// ─── 1. Recommendations (12+ for the April 2026 cycle) ──────────────────

export function generatePayrollRecommendations(): PayrollRecommendation[] {
  const data = safeData();
  const out: PayrollRecommendation[] = [];

  // 1. Mohammad Al-Ghamdi final settlement (the headline 12-yr veteran case)
  const mohammad = data.employees.find((e) => e.id === "emp-alnakhla-003");
  if (mohammad) {
    out.push({
      id: "rec-001",
      type: "final-settlement",
      title: `Final settlement — ${mohammad.fullNameEn}`,
      summary: `12-year veteran Site Supervisor separating 30 Apr 2026 by mutual agreement. Total settlement SAR 196,450 (EOSB 166,250 + leave encashment 10,500 + remaining April salary 19,700).`,
      targetRole: "finance-controller",
      severity: "critical",
      confidence: 99,
      reasoning: [
        {
          source: "Employee Records Database",
          observation:
            "Mohammad Al-Ghamdi tenure: 12 years, 0 months. Contract type: unlimited. Last basic: SAR 14,000, housing: SAR 3,500.",
          conclusion: "Employee qualifies for full EOSB under Article 84 KSA Labour Law.",
        },
        {
          source: "EOSB Calculation Engine",
          observation:
            "First 5 years: 5 × 0.5 × 17,500 = SAR 43,750. Remaining 7 years: 7 × 1.0 × 17,500 = SAR 122,500.",
          conclusion: "Total EOSB SAR 166,250. Mutual agreement → full amount applies.",
        },
        {
          source: "Leave Balance System",
          observation: "18 unused annual leave days at daily rate SAR 583.33.",
          conclusion: "Leave encashment SAR 10,500. Combined with remaining April salary SAR 19,700, total SAR 196,450.",
        },
      ],
      impact: {
        cost: "SAR 196,450 one-time settlement",
        compliance: "Article 84 fully satisfied; no labour-court exposure",
        sla: "Mudad WPS final transfer in <5 business days of sign-off",
      },
      recommendedAction: "Approve total settlement; agent will trigger Mudad final WPS submission upon e-signature.",
      alternatives: [
        "Phase the settlement across 2 instalments (May + June 2026)",
        "Hold pending exit clearance from Site 14",
      ],
      status: "pending",
      createdAt: isoDaysAgo(2),
    });
  }

  // 2. Noura Al-Salem salary increase
  const noura = data.employees.find((e) => e.id === "emp-vertex-001");
  if (noura) {
    out.push({
      id: "rec-002",
      type: "salary-adjustment",
      title: `Salary increase — ${noura.fullNameEn} (SAR 15,000 → SAR 17,000)`,
      summary: `Software Developer at Vertex Tech, 2 years tenure, exceeds-expectations rating. 13.3% increase aligns with Riyadh tech-market median; effective 1 May 2026.`,
      targetRole: "finance-controller",
      severity: "medium",
      confidence: 94,
      reasoning: [
        {
          source: "Performance Review (Q1 2026)",
          observation: "Exceeds expectations 3 quarters running; led 2 successful releases.",
          conclusion: "Retention risk if not adjusted — 1 active recruiter approach detected.",
        },
        {
          source: "Salary Benchmark Engine",
          observation: "Senior dev range SAR 16,500–18,500 in Riyadh tech sector; Noura currently 9% below median.",
          conclusion: "Proposed SAR 17,000 lands at the 50th percentile.",
        },
        {
          source: "GOSI Cost Model",
          observation: "Basic +SAR 2,000 → +SAR 240/mo employer annuity, +SAR 200/mo employee annuity, +SAR 40/mo OHRP.",
          conclusion: "GOSI auto-recalculates from May 2026; total marginal employer cost SAR 2,280/month.",
        },
      ],
      impact: {
        cost: "+SAR 27,360 annual cost (incl. GOSI re-base)",
        compliance: "GOSI base recalculated automatically; no Mudad change",
        sla: "First adjusted payslip ready by 25 May 2026",
      },
      recommendedAction: "Approve increase to SAR 17,000 effective 1 May 2026.",
      alternatives: ["10% increase + SAR 5,000 retention bonus", "Defer 90 days pending Q2 review"],
      status: "pending",
      createdAt: isoDaysAgo(1),
    });
  }

  // 3. Vertex Tech Saudization Yellow band recovery
  const vertex = data.clients.find((c) => c.id === "client-vertex");
  if (vertex) {
    out.push({
      id: "rec-003",
      type: "saudization-action",
      title: `Vertex Tech — Yellow band recovery plan`,
      summary: `Saudization at 50% (Yellow). Hiring 2 Saudi developers exits Yellow band into Green-Low (target 58%) before Q2 Nitaqat review (1 Jul 2026).`,
      targetRole: "compliance-officer",
      severity: "high",
      confidence: 86,
      reasoning: [
        {
          source: "Saudization Monitor — 6-month trend",
          observation: "Saudi headcount static at 5; 1 expat hire in Q1 dropped band to Yellow.",
          conclusion: "Without action, Q2 review will lock band as Yellow.",
        },
        {
          source: "Nitaqat Threshold Tables (MOHRS)",
          observation: "Yellow → Green-Low boundary at 56% for tech firms <50 employees.",
          conclusion: "+2 Saudi hires (12 total → 7 Saudi out of 12) lands at 58.3%.",
        },
        {
          source: "HRDF Tamheer Programme",
          observation: "12-month subsidised on-the-job training for Saudi graduates available.",
          conclusion: "Net cost per Saudi hire reduced by SAR 36K via Tamheer subsidy.",
        },
      ],
      impact: {
        cost: "Net SAR 144K incremental annual payroll (post-Tamheer)",
        compliance: "Exits Yellow band; clears Iqama issuance freeze risk",
        sla: "Both hires onboard before 1 Jul 2026 Nitaqat review",
      },
      recommendedAction: "Open 2 junior Saudi developer roles via HRDF Tamheer; refocus existing search.",
      alternatives: [
        "Promote 1 internal Saudi engineer + hire 1 Saudi dev",
        "Accept Yellow Q2 — recover Q3 with deeper hiring sprint",
      ],
      status: "pending",
      createdAt: isoDaysAgo(1),
    });
  }

  // 4. April 2026 GOSI filing approval
  out.push({
    id: "rec-004",
    type: "gosi-filing-approval",
    title: `Approve April 2026 GOSI filing — all 3 clients`,
    summary: `Combined April GOSI submission ready: 42 employees, employer SAR 41,890 + employee SAR 12,450 = SAR 54,340. Filing window closes 15 May 2026.`,
    targetRole: "compliance-officer",
    severity: "critical",
    confidence: 99,
    reasoning: [
      {
        source: "GOSI Compliance Agent",
        observation: "All 42 employee records validated against Muqeem registry.",
        conclusion: "0 errors, 0 warnings.",
      },
      {
        source: "Salary Calculation Agent",
        observation: "Basic + housing matches signed contracts for all 42 employees.",
        conclusion: "No drift versus March 2026 baseline.",
      },
      {
        source: "Regulatory Calendar",
        observation: "Filing deadline 15 May 2026 (19 days away); recommended buffer ≥3 days.",
        conclusion: "On schedule for 12 May 2026 submission.",
      },
    ],
    impact: {
      cost: "SAR 54,340 total contribution",
      compliance: "Avoids 2% late-filing penalty; preserves 18-month on-time streak",
      sla: "Filing within 19-day window — well ahead of deadline",
    },
    recommendedAction: "Sign filing electronically; agent submits to GOSI portal within 1 hour.",
    alternatives: ["Defer 24h pending Mohammad Al-Ghamdi exit confirmation", "File per-client (3 separate submissions)"],
    status: "pending",
    createdAt: isoHoursAgo(2),
  });

  // 5. Ahmed Al-Rashidi retroactive promotion adjustment
  const ahmed = data.employees.find((e) => e.id === "emp-alnakhla-001");
  if (ahmed) {
    out.push({
      id: "rec-005",
      type: "retroactive-adjustment",
      title: `Retroactive promotion adjustment — ${ahmed.fullNameEn}`,
      summary: `Promoted from Senior Engineer to Project Manager 1 Mar 2026 — 2-month retroactive top-up of SAR 4,600 due in April payroll.`,
      targetRole: "payroll-manager",
      severity: "high",
      confidence: 98,
      reasoning: [
        {
          source: "HR Promotion Letter (ANK-HR-2026-0301)",
          observation: "Effective date 2026-03-01. Old basic SAR 15,700 → new basic SAR 18,000 (delta SAR 2,300/month).",
          conclusion: "2 months × SAR 2,300 = SAR 4,600 retroactive owed.",
        },
        {
          source: "Payroll Run Audit",
          observation: "Feb and Mar 2026 payslips processed on previous (Senior Engineer) salary.",
          conclusion: "Adjustment must be applied as separate retroactive line in April payslip.",
        },
        {
          source: "GOSI Reconciliation",
          observation: "GOSI base correction: 2 × SAR 2,300 = SAR 4,600 additional employer + employee contribution recalculated in April filing.",
          conclusion: "Filing notes will reference promotion letter for audit trail.",
        },
      ],
      impact: {
        cost: "SAR 4,600 retroactive + SAR 552 GOSI re-base catch-up",
        compliance: "Promotion + GOSI base aligned; audit trail complete",
        sla: "Included in 25 Apr payroll run, paid 28 Apr",
      },
      recommendedAction: "Approve retroactive line; pay in April 2026 payslip.",
      alternatives: ["Spread retro across May + June payslips", "Pay as separate one-off transfer"],
      status: "pending",
      createdAt: isoHoursAgo(18),
    });
  }

  // 6. Sarah Johnson Q1 performance bonus (already issued — informational rec)
  const sarah = data.employees.find((e) => e.id === "emp-vertex-002");
  if (sarah) {
    out.push({
      id: "rec-006",
      type: "bonus",
      title: `Q1 2026 performance bonus — ${sarah.fullNameEn}`,
      summary: `CTO at Vertex Tech, exceeds-expectations rating, SAR 15,000 Q1 bonus already approved by CEO; included in April 2026 payroll.`,
      targetRole: "finance-controller",
      severity: "low",
      confidence: 99,
      reasoning: [
        {
          source: "Bonus Letter (VTX-FIN-2026-Q1-01)",
          observation: "SAR 15,000 Q1 2026 performance bonus signed by CEO 15 Apr 2026.",
          conclusion: "Authorisation complete.",
        },
        {
          source: "Payroll Run April 2026",
          observation: "Bonus line item included in Sarah's April payslip.",
          conclusion: "No further action required.",
        },
      ],
      impact: {
        cost: "SAR 15,000 (already budgeted in Q1 2026 plan)",
        compliance: "OHRP-only base for non-Saudi; no GOSI impact",
        sla: "Paid via Mudad on 28 Apr 2026",
      },
      recommendedAction: "Acknowledge — included in April Mudad batch.",
      alternatives: [],
      status: "approved",
      createdAt: isoDaysAgo(11),
      decidedBy: "Faisal Al-Tamimi",
      decisionNote: "Q1 performance exceeded expectations; bonus approved per Vertex compensation policy.",
    });
  }

  // 7. Aisha Al-Harbi maternity leave
  const aisha = data.employees.find((e) => e.id === "emp-alnakhla-004");
  if (aisha) {
    out.push({
      id: "rec-007",
      type: "leave-approval",
      title: `Maternity leave — ${aisha.fullNameEn} (70 days from 15 May 2026)`,
      summary: `HR Coordinator at Al-Nakhla. 6-year tenure. Eligibility confirmed under Article 151. Payroll impact SAR 11,000/month for 70 days.`,
      targetRole: "payroll-manager",
      severity: "medium",
      confidence: 99,
      reasoning: [
        {
          source: "Maternity Approval Document (ANK-HR-2026-0422)",
          observation: "Leave start 2026-05-15; duration 70 days; expected return 2026-07-24.",
          conclusion: "Documents complete; eligibility confirmed.",
        },
        {
          source: "Article 151 KSA Labour Law",
          observation: "70 days fully paid maternity entitlement.",
          conclusion: "Compliant — no co-pay required.",
        },
        {
          source: "Cover Plan",
          observation: "Junior HR coordinator (existing) absorbs admin during leave; no temp hire needed.",
          conclusion: "Operational impact minimal.",
        },
      ],
      impact: {
        cost: "SAR 25,667 paid leave (70/30 × SAR 11,000)",
        compliance: "Article 151 fully satisfied",
        sla: "Maternity payroll runs auto-generated for May, Jun, Jul 2026",
      },
      recommendedAction: "Acknowledge — leave system already updated.",
      alternatives: [],
      status: "approved",
      createdAt: isoDaysAgo(4),
      decidedBy: "Saad Al-Hammadi",
      decisionNote: "Documents complete; eligibility confirmed under Article 151.",
    });
  }

  // 8. Rajesh Kumar Iqama renewal
  const rajesh = data.employees.find((e) => e.id === "emp-alnakhla-002");
  if (rajesh) {
    out.push({
      id: "rec-008",
      type: "iqama-renewal",
      title: `Iqama renewal — ${rajesh.fullNameEn} (expires 15 Jul 2026)`,
      summary: `Civil Engineer at Al-Nakhla. Iqama 2123456003 expires in 80 days — renewal window opens now (60-day rule).`,
      targetRole: "compliance-officer",
      severity: "medium",
      confidence: 99,
      reasoning: [
        { source: "Muqeem Registry", observation: "Iqama 2123456003 expires 2026-07-15.", conclusion: "80 days to expiry." },
        {
          source: "Regulatory Calendar",
          observation: "Standard renewal window: 30–60 days before expiry.",
          conclusion: "Renewal can be filed from 15 May 2026.",
        },
        {
          source: "Cost Model",
          observation: "Late renewal penalty SAR 500/month; standard fee SAR 650 for 1-year renewal.",
          conclusion: "Acting in window avoids penalty.",
        },
      ],
      impact: {
        cost: "SAR 650 government fee",
        compliance: "Maintains Qiwa work-permit continuity",
        sla: "Renewal completed within 14 days of submission",
      },
      recommendedAction: "Initiate 1-year renewal via Absher portal on 15 May 2026.",
      alternatives: ["2-year renewal (SAR 1,200)", "Combine with contract renewal in single submission"],
      status: "pending",
      createdAt: isoDaysAgo(3),
    });
  }

  // 9. Khalid Al-Otaibi probation review
  const khalid = data.employees.find((e) => e.id === "emp-luma-002");
  if (khalid) {
    out.push({
      id: "rec-009",
      type: "probation-review",
      title: `Probation milestone — ${khalid.fullNameEn} (month 2 of 3)`,
      summary: `Sales Associate at Luma Retail. Probation ends 30 May 2026. Performance to date: meeting expectations. Recommend confirmation.`,
      targetRole: "payroll-manager",
      severity: "low",
      confidence: 88,
      reasoning: [
        { source: "Employment Contract", observation: "90-day probation per Article 53-54.", conclusion: "Probation ends 2026-05-30." },
        {
          source: "Manager Feedback (Maha Al-Suwaidi)",
          observation: "Meets sales targets, on-track with onboarding training.",
          conclusion: "No red flags.",
        },
        {
          source: "GOSI Subscription",
          observation: "Registered 12 Mar 2026; first contribution filed in March cycle.",
          conclusion: "GOSI compliance complete.",
        },
      ],
      impact: {
        cost: "No incremental cost — confirmation activates standard contract terms",
        compliance: "Probation period closed within 90-day legal limit",
        sla: "Confirmation letter generated within 2 days of approval",
      },
      recommendedAction: "Schedule probation review meeting 25 May 2026; prepare confirmation letter.",
      alternatives: ["Extend probation 90 days (requires written agreement)", "End contract — give 30-day notice"],
      status: "pending",
      createdAt: isoHoursAgo(36),
    });
  }

  // 10. Fatima Al-Zahrani vacation salary advance
  const fatima = data.employees.find((e) => e.id === "emp-luma-001");
  if (fatima) {
    out.push({
      id: "rec-010",
      type: "leave-approval",
      title: `Vacation salary advance — ${fatima.fullNameEn} (SAR 11,200)`,
      summary: `Store Manager taking 21-day annual leave from 10 May 2026. KSA Labour Law requires vacation salary paid in advance.`,
      targetRole: "payroll-manager",
      severity: "medium",
      confidence: 98,
      reasoning: [
        {
          source: "Leave Request (LMR-HR-2026-0418)",
          observation: "21-day annual leave approved 18 Apr 2026; start 2026-05-10.",
          conclusion: "Within entitlement (21 days for <5 yrs service).",
        },
        {
          source: "Vacation Salary Calculation",
          observation: "Daily rate (basic + housing) / 30 = (12,000 + 3,000) / 30 = SAR 500. 21 × 500 = SAR 10,500. Plus transport/other allowances pro-rata.",
          conclusion: "Advance amount SAR 11,200 (rounded for benefits).",
        },
        {
          source: "Mudad Schedule",
          observation: "Advance paid 5 May 2026 (5 business days before leave start).",
          conclusion: "Compliant with Article 109 advance-payment rule.",
        },
      ],
      impact: {
        cost: "SAR 11,200 advance (offset across May payslip)",
        compliance: "Article 109 vacation salary advance rule satisfied",
        sla: "Mudad transfer 5 May 2026",
      },
      recommendedAction: "Approve advance; agent triggers Mudad transfer 5 May 2026.",
      alternatives: ["Pay with regular May payroll (non-compliant)", "Pay 50% advance / 50% after return (employee request)"],
      status: "approved",
      createdAt: isoDaysAgo(8),
      decidedBy: "Maha Al-Suwaidi",
      decisionNote: "Standard advance per labour-law requirement.",
    });
  }

  // 11. Rajesh Kumar contract renewal
  if (rajesh) {
    out.push({
      id: "rec-011",
      type: "contract-renewal",
      title: `2-year contract renewal — ${rajesh.fullNameEn}`,
      summary: `Civil Engineer at Al-Nakhla. Current contract expires 30 Jun 2026. 2-year renewal recommended; renewal letter prepared.`,
      targetRole: "compliance-officer",
      severity: "medium",
      confidence: 96,
      reasoning: [
        {
          source: "Contract Database",
          observation: "Limited contract started 2023-04-01; ends 2026-06-30.",
          conclusion: "Renewal must be signed and registered with Qiwa before expiry to avoid Iqama gap.",
        },
        {
          source: "Manager Endorsement",
          observation: "Performance review average 4.4/5; key resource on Site 9 high-rise project (12 months remaining).",
          conclusion: "Strong renewal case.",
        },
        {
          source: "Iqama Linkage",
          observation: "Iqama 2123456003 also renews 15 Jul 2026 — combine submissions.",
          conclusion: "Single Qiwa update covers both.",
        },
      ],
      impact: {
        cost: "Same compensation tier — no cost change",
        compliance: "Qiwa contract authentication maintained; Iqama tied to live contract",
        sla: "Renewal effective 1 Jul 2026, registered on Qiwa within 7 days",
      },
      recommendedAction: "Send renewal letter (ANK-HR-2026-0418) for employee signature; register on Qiwa.",
      alternatives: ["1-year renewal (more flexibility)", "Convert to unlimited contract"],
      status: "pending",
      createdAt: isoDaysAgo(7),
    });
  }

  // 12. April 2026 Mudad WPS submission
  out.push({
    id: "rec-012",
    type: "mudad-submission",
    title: `Approve April 2026 Mudad WPS submission — 42 employees`,
    summary: `Mudad WPS file ready for all 3 clients: 42 net payments totalling SAR 489,300. IBANs validated (0 rejections expected).`,
    targetRole: "payroll-manager",
    severity: "critical",
    confidence: 97,
    reasoning: [
      {
        source: "Mudad & Bank Transfer Agent",
        observation: "All 42 IBANs validated against Mudad-registered Saudi-bank registry.",
        conclusion: "0 invalid IBANs; ready to submit.",
      },
      {
        source: "Salary Calculation Agent",
        observation: "Net amounts reconciled with payslips; total SAR 489,300 (incl. Mohammad's SAR 196,450 final settlement).",
        conclusion: "Reconciliation passed.",
      },
      {
        source: "Compliance Calendar",
        observation: "WPS deadline 7 May 2026 (Article 91); recommended submission 27 Apr.",
        conclusion: "Comfortable buffer.",
      },
    ],
    impact: {
      cost: "SAR 489,300 net payroll (incl. final settlement)",
      compliance: "Avoids WPS late flag; maintains MOHRS green status",
      sla: "All employees paid on or before 28 Apr 2026",
    },
    recommendedAction: "Approve Mudad submission; agent files file 27 Apr 2026.",
    alternatives: ["Split submission (regular + final settlement separately)", "Hold final settlement until 1 May (post-cycle)"],
    status: "pending",
    createdAt: isoHoursAgo(4),
  });

  return out;
}

// ─── 2. Tasks ────────────────────────────────────────────────────────────

export function generatePayrollTasks(): PayrollTask[] {
  const data = safeData();
  const out: PayrollTask[] = [];

  out.push({
    id: "task-001",
    title: "Sign April 2026 GOSI filing",
    description: "Compliance Officer to digitally sign the consolidated April 2026 GOSI submission file.",
    assignee: "Compliance Officer",
    assigneeRole: "compliance-officer",
    priority: "critical",
    deadline: isoDaysFromNow(3),
    status: "open",
    linkedRecommendation: "rec-004",
    createdAt: isoHoursAgo(2),
  });

  out.push({
    id: "task-002",
    title: "Approve April 2026 payroll runs (3 clients)",
    description: "Review and approve April 2026 runs for Al-Nakhla, Luma Retail, and Vertex Tech (42 employees, SAR 538K gross).",
    assignee: "Payroll Manager",
    assigneeRole: "payroll-manager",
    priority: "high",
    deadline: isoDaysFromNow(1),
    status: "in-progress",
    createdAt: isoDaysAgo(1),
  });

  out.push({
    id: "task-003",
    title: "Final settlement sign-off — Mohammad Al-Ghamdi (SAR 196,450)",
    description: "Finance Controller to authorise EOSB SAR 166,250 + leave SAR 10,500 + remaining salary SAR 19,700.",
    assignee: "Finance Controller",
    assigneeRole: "finance-controller",
    priority: "critical",
    deadline: isoDaysFromNow(2),
    status: "open",
    linkedRecommendation: "rec-001",
    createdAt: isoDaysAgo(2),
  });

  out.push({
    id: "task-004",
    title: "Approve Noura Al-Salem salary increase",
    description: "Finance Controller to approve increase from SAR 15,000 to SAR 17,000 effective 1 May 2026.",
    assignee: "Finance Controller",
    assigneeRole: "finance-controller",
    priority: "medium",
    deadline: isoDaysFromNow(4),
    status: "open",
    linkedRecommendation: "rec-002",
    createdAt: isoDaysAgo(1),
  });

  out.push({
    id: "task-005",
    title: "Vertex Tech — Yellow band recovery action plan",
    description: "Compliance Officer + Vertex hiring manager to scope 2 Saudi developer hires via HRDF Tamheer.",
    assignee: "Compliance Officer",
    assigneeRole: "compliance-officer",
    priority: "high",
    deadline: isoDaysFromNow(14),
    status: "in-progress",
    linkedRecommendation: "rec-003",
    createdAt: isoDaysAgo(3),
  });

  out.push({
    id: "task-006",
    title: "Sign April 2026 Mudad WPS submission",
    description: "Payroll Manager to approve April Mudad batch (42 payments, SAR 489,300).",
    assignee: "Payroll Manager",
    assigneeRole: "payroll-manager",
    priority: "critical",
    deadline: isoDaysFromNow(1),
    status: "open",
    linkedRecommendation: "rec-012",
    createdAt: isoHoursAgo(4),
  });

  out.push({
    id: "task-007",
    title: "Probation review — Khalid Al-Otaibi",
    description: "Schedule probation milestone meeting 25 May 2026; prepare confirmation letter.",
    assignee: "Payroll Manager",
    assigneeRole: "payroll-manager",
    priority: "low",
    deadline: isoDaysFromNow(28),
    status: "open",
    linkedRecommendation: "rec-009",
    createdAt: isoHoursAgo(36),
  });

  out.push({
    id: "task-008",
    title: "File Rajesh Kumar contract renewal on Qiwa",
    description: "Submit signed renewal letter to Qiwa; pre-stage Iqama renewal for Jul 2026.",
    assignee: "Compliance Officer",
    assigneeRole: "compliance-officer",
    priority: "medium",
    deadline: isoDaysFromNow(20),
    status: "open",
    linkedRecommendation: "rec-011",
    createdAt: isoDaysAgo(7),
  });

  // Pull additional tasks from in-progress service requests
  data.serviceRequests
    .filter((r) => r.status === "in-progress" || r.status === "in-review")
    .slice(0, 2)
    .forEach((r, i) => {
      out.push({
        id: `task-sr-${r.id}`,
        title: r.titleEn,
        description: r.description,
        assignee: r.assignedAgent ? getAgentName(r.assignedAgent, "en") : "Operations Team",
        assigneeRole: r.priority === "critical" || r.priority === "high" ? "compliance-officer" : "payroll-manager",
        priority: (r.priority as Severity) ?? "medium",
        deadline: isoDaysFromNow(3 + i * 2),
        status: r.status === "in-progress" ? "in-progress" : "open",
        createdAt: r.requestedAt,
      });
    });

  return out;
}

// ─── 3. Alerts ──────────────────────────────────────────────────────────

export function generatePayrollAlerts(): PayrollAlert[] {
  const data = safeData();
  const alerts: PayrollAlert[] = [];

  alerts.push({
    id: "alert-001",
    type: "regulatory-deadline",
    title: "GOSI April 2026 filing — 19 days to deadline",
    detail: "All 3 clients reconciled and ready for Compliance Officer e-signature. Filing window closes 15 May 2026.",
    severity: "high",
    category: "Compliance",
    timestamp: isoHoursAgo(2),
  });

  alerts.push({
    id: "alert-002",
    type: "saudization-band",
    title: "Vertex Tech — Yellow band confirmed at Q1 review",
    detail: "Q2 review on 1 Jul 2026. Action plan in progress: 2 Saudi developer hires via HRDF Tamheer.",
    severity: "high",
    category: "Saudization",
    timestamp: isoDaysAgo(2),
  });

  alerts.push({
    id: "alert-003",
    type: "iqama-expiry",
    title: "1 Iqama renewal window opening — Rajesh Kumar",
    detail: "Iqama 2123456003 expires 15 Jul 2026. Renewal window opens 15 May 2026 (50 days from expiry).",
    severity: "medium",
    category: "Compliance",
    timestamp: isoDaysAgo(3),
  });

  alerts.push({
    id: "alert-004",
    type: "settlement-pending",
    title: "Mohammad Al-Ghamdi final settlement — Finance approval pending",
    detail: "Total SAR 196,450 (EOSB 166,250 + leave 10,500 + salary 19,700). 2 days until last working day (30 Apr).",
    severity: "critical",
    category: "Settlement",
    timestamp: isoHoursAgo(8),
  });

  alerts.push({
    id: "alert-005",
    type: "agent-drift",
    title: "Client Communications Agent — bilingual tone calibration drift",
    detail: "Performance & Audit Agent flagged a 0.04 drop in Arabic-reply tone consistency. Calibration scheduled for next cycle.",
    severity: "low",
    category: "Agent Health",
    timestamp: isoDaysAgo(1),
  });

  alerts.push({
    id: "alert-006",
    type: "high-confidence-extraction",
    title: "12 documents auto-extracted with >97% confidence",
    detail: "All field-level confidence scores exceeded threshold this cycle. Human verification queue empty.",
    severity: "low",
    category: "Documents",
    timestamp: isoHoursAgo(20),
  });

  alerts.push({
    id: "alert-007",
    type: "wps-deadline",
    title: "April Mudad WPS — submit by 27 Apr 2026",
    detail: "42 net payments totalling SAR 489,300 staged. Awaiting Payroll Manager sign-off.",
    severity: "high",
    category: "Compliance",
    timestamp: isoHoursAgo(4),
  });

  alerts.push({
    id: "alert-008",
    type: "leave-event",
    title: "Aisha Al-Harbi maternity leave begins 15 May 2026",
    detail: "70-day paid maternity leave; payroll auto-rolls May/Jun/Jul cycles.",
    severity: "low",
    category: "Leave",
    timestamp: isoDaysAgo(4),
  });

  alerts.push({
    id: "alert-009",
    type: "leave-event",
    title: "Fatima Al-Zahrani vacation salary advance — SAR 11,200",
    detail: "21-day annual leave starts 10 May 2026; advance scheduled 5 May 2026 per Article 109.",
    severity: "medium",
    category: "Leave",
    timestamp: isoDaysAgo(8),
  });

  alerts.push({
    id: "alert-010",
    type: "retroactive-adjustment",
    title: "Ahmed Al-Rashidi 2-month retroactive — SAR 4,600 in April payslip",
    detail: "Promotion effective 1 Mar 2026; retroactive top-up included in April Al-Nakhla payroll run.",
    severity: "medium",
    category: "Adjustments",
    timestamp: isoHoursAgo(18),
  });

  // Calendar-driven alerts
  data.regulatoryCalendar
    .filter((c) => c.type === "upcoming")
    .slice(0, 2)
    .forEach((c) => {
      alerts.push({
        id: `alert-cal-${c.id}`,
        type: "regulatory-deadline",
        title: c.nameEn,
        detail: c.descriptionEn,
        severity: "medium",
        category: "Calendar",
        timestamp: isoDaysAgo(0),
      });
    });

  return alerts;
}

// ─── 4. Playbooks (constant) ────────────────────────────────────────────

export const PAYROLL_PLAYBOOKS: PayrollPlaybook[] = [
  {
    id: "play-001",
    name: "Monthly Payroll Cycle — April 2026",
    trigger: "1st of month — automatic",
    status: "awaiting-approval",
    startedAt: isoDaysAgo(3),
    steps: [
      { agent: "payroll-orchestrator", action: "Plan cycle, dispatch 9 specialist agents", status: "completed", output: "3 clients, 42 employees in scope" },
      { agent: "document-intelligence", action: "Process new HR documents", status: "completed", output: "12 docs, 0.98 avg confidence" },
      { agent: "leave-management", action: "Reconcile leave balances + advance for Fatima", status: "completed", output: "1 maternity, 1 annual, advance SAR 11,200" },
      { agent: "salary-calculation", action: "Compute gross-to-net + retroactive (Ahmed)", status: "completed", output: "42 payslips, SAR 538,000 gross" },
      { agent: "eosb-provision", action: "Accrue EOSB and prepare Mohammad's settlement", status: "completed", output: "SAR 196,450 final settlement awaiting approval" },
      { agent: "gosi-compliance", action: "Generate April 2026 GOSI filing", status: "completed", output: "Employer 41,890 + employee 12,450 = SAR 54,340" },
      { agent: "human-checkpoint", action: "Payroll Manager approval", status: "running" },
      { agent: "human-checkpoint", action: "Finance Controller approval (final settlement)", status: "pending" },
      { agent: "mudad-bank-transfer", action: "Submit Mudad WPS file (incl. final settlement)", status: "pending" },
      { agent: "client-communications", action: "Distribute April run summary to all 3 clients", status: "pending" },
    ],
    linkedRecommendation: "rec-004",
  },
  {
    id: "play-002",
    name: "Final Settlement — Mohammad Al-Ghamdi",
    trigger: "Mutual termination accepted on 10 Apr 2026",
    status: "awaiting-approval",
    startedAt: isoDaysAgo(16),
    steps: [
      { agent: "document-intelligence", action: "Process termination letter", status: "completed", output: "Mutual agreement, notice 30 days served" },
      { agent: "eosb-provision", action: "Compute EOSB at 12 yrs", status: "completed", output: "SAR 166,250 (5×0.5×17,500 + 7×1.0×17,500)" },
      { agent: "leave-management", action: "Compute unused leave encashment", status: "completed", output: "18 days × 583.33 = SAR 10,500" },
      { agent: "salary-calculation", action: "Compute remaining April salary", status: "completed", output: "Full month: SAR 19,700" },
      { agent: "human-checkpoint", action: "Finance Controller authorisation", status: "running" },
      { agent: "mudad-bank-transfer", action: "Trigger final WPS payment", status: "pending" },
      { agent: "client-communications", action: "Issue experience letter & settlement statement", status: "pending" },
    ],
    linkedRecommendation: "rec-001",
  },
  {
    id: "play-003",
    name: "Saudization Recovery — Vertex Tech",
    trigger: "Saudization Monitor — Yellow band recovery target",
    status: "running",
    startedAt: isoDaysAgo(7),
    steps: [
      { agent: "saudization-monitor", action: "Quantify recovery scenario", status: "completed", output: "+2 Saudi devs → 58.3% (Green-Low)" },
      { agent: "client-communications", action: "Brief Vertex hiring manager", status: "completed", output: "HRDF Tamheer pre-approved 2 slots" },
      { agent: "human-checkpoint", action: "Compliance Officer approves action plan", status: "running" },
      { agent: "client-communications", action: "Open 2 junior Saudi dev roles", status: "pending" },
    ],
    linkedRecommendation: "rec-003",
  },
  {
    id: "play-004",
    name: "Onboarding — Khalid Al-Otaibi",
    trigger: "New hire effective 1 Mar 2026 (Luma Retail)",
    status: "running",
    startedAt: isoDaysAgo(57),
    steps: [
      { agent: "document-intelligence", action: "Process employment contract", status: "completed", output: "Contract digitised, 0.98 confidence" },
      { agent: "gosi-compliance", action: "Register GOSI subscription", status: "completed", output: "G-2026-LMR-007 confirmed 12 Mar" },
      { agent: "salary-calculation", action: "First payslip (March)", status: "completed", output: "Pro-rata SAR 6,250" },
      { agent: "salary-calculation", action: "April probation payslip", status: "completed", output: "SAR 6,750 net" },
      { agent: "human-checkpoint", action: "Probation milestone review (25 May 2026)", status: "pending" },
      { agent: "client-communications", action: "Prepare confirmation letter (post-review)", status: "pending" },
    ],
    linkedRecommendation: "rec-009",
  },
  {
    id: "play-005",
    name: "GOSI Monthly Filing — April 2026",
    trigger: "Payroll cycle close → automatic",
    status: "awaiting-approval",
    startedAt: isoDaysAgo(2),
    steps: [
      { agent: "gosi-compliance", action: "Pull employee + salary data", status: "completed", output: "42 employees, all clients" },
      { agent: "gosi-compliance", action: "Compute contributions per employee", status: "completed", output: "Employer 41,890 + employee 12,450" },
      { agent: "performance-audit", action: "Validate against contracts and Muqeem", status: "completed", output: "0 errors, 0 warnings" },
      { agent: "human-checkpoint", action: "Compliance Officer e-signs and files", status: "pending" },
    ],
    linkedRecommendation: "rec-004",
  },
];

// ─── 5. Activity log (live agent feed) ──────────────────────────────────

export function generateActivityLog(): PayrollActivityEntry[] {
  const out: PayrollActivityEntry[] = [];
  const events: Array<[TasamaAgentId, PayrollActivityEntry["type"], string, string, number]> = [
    ["payroll-orchestrator", "orchestration", "Dispatched April 2026 cycle to 9 specialist agents", "All clients in scope", 0.5],
    ["document-intelligence", "extraction", "Extracted 7 fields from termination letter", "Mohammad Al-Ghamdi — 0.98 confidence", 1.5],
    ["salary-calculation", "calculation", "Computed gross-to-net for Al-Nakhla", "18 payslips in 0.7s; retroactive line for Ahmed Al-Rashidi", 2.3],
    ["gosi-compliance", "filing", "Generated April 2026 GOSI file", "SAR 54,340 total — awaiting signature", 3.1],
    ["eosb-provision", "calculation", "Final settlement computed for Mohammad Al-Ghamdi", "SAR 196,450 (EOSB 166,250 + leave 10,500 + salary 19,700)", 4.0],
    ["mudad-bank-transfer", "transfer", "Validated 42 IBANs against Mudad bank registry", "0 rejections", 5.5],
    ["saudization-monitor", "monitoring", "Recomputed Saudization for Vertex Tech", "50.0% — Yellow band; recovery scenario modelled", 6.2],
    ["leave-management", "calculation", "Approved Fatima Al-Zahrani vacation advance", "SAR 11,200 (21 days × daily rate)", 7.0],
    ["performance-audit", "audit", "Generated April audit pack", "All 10 agents within tolerance", 8.5],
    ["client-communications", "communication", "Drafted April run summary for Luma Retail", "Pending Payroll Manager approval", 9.5],
    ["document-intelligence", "extraction", "Processed bonus letter — Sarah Johnson", "SAR 15,000 Q1 bonus, 0.99 confidence", 11.0],
    ["gosi-compliance", "filing", "Validated GOSI base for 42 employees", "0 mismatches against contracts", 12.5],
    ["salary-calculation", "calculation", "Applied 2-month retroactive for Ahmed Al-Rashidi", "SAR 4,600 (2 × SAR 2,300)", 14.0],
    ["leave-management", "monitoring", "Aisha Al-Harbi maternity leave staged for 15 May start", "70-day plan in payroll roll", 15.5],
    ["client-communications", "communication", "Sent salary certificate to Ahmed Al-Rashidi", "Bank loan application — Al Rajhi", 17.0],
    ["payroll-orchestrator", "orchestration", "Pre-staged May 2026 cycle dependencies", "Noura Al-Salem increase, Fatima leave, Aisha maternity", 19.0],
  ];
  for (const [agentId, type, action, detail, hours] of events) {
    out.push({
      id: `act-${agentId}-${Math.round(hours * 10)}`,
      agent: agentId,
      agentName: getAgentName(agentId, "en"),
      action,
      detail,
      timestamp: isoHoursAgo(hours),
      type,
    });
  }
  return out;
}

// ─── 6. Decision history ───────────────────────────────────────────────

export function generateDecisionHistory(): PayrollDecisionLog[] {
  return [
    {
      id: "dec-001",
      recommendationId: "rec-prev-08",
      recommendationTitle: "March 2026 GOSI filing approval",
      decisionType: "approved",
      decidedBy: "Compliance Officer",
      role: "compliance-officer",
      timestamp: "2026-04-12T11:30:00Z",
      rationale: "All checks passed; 0 drift vs February submission. Filed 3 days ahead of deadline.",
      simulatedOutcome: {
        cost: "SAR 53,720 contribution",
        compliance: "18-month on-time streak preserved",
        sla: "Filed 12 Apr — 3 days early",
        timeframe: "March 2026 cycle",
      },
    },
    {
      id: "dec-002",
      recommendationId: "rec-prev-07",
      recommendationTitle: "Sarah Johnson Q1 2026 performance bonus",
      decisionType: "approved",
      decidedBy: "Finance Controller",
      role: "finance-controller",
      timestamp: "2026-04-15T14:00:00Z",
      rationale: "Q1 metrics exceeded targets; bonus aligns with policy.",
      simulatedOutcome: {
        cost: "+SAR 15,000 one-off",
        compliance: "Non-Saudi: OHRP only — no annuity impact",
        sla: "Paid in April Mudad batch",
        timeframe: "April 2026",
      },
    },
    {
      id: "dec-003",
      recommendationId: "rec-prev-06",
      recommendationTitle: "Vertex Tech March Mudad — split submission",
      decisionType: "modified",
      decidedBy: "Payroll Manager",
      role: "payroll-manager",
      timestamp: "2026-03-26T09:15:00Z",
      rationale: "Bank rejected 1 IBAN — split to expedite payment for the other 9.",
      modificationNote: "Resubmitted David Chen's payment 28 Mar after IBAN correction.",
      simulatedOutcome: {
        cost: "0 SAR penalty",
        compliance: "Mudad green status maintained",
        sla: "9 payments on time; 1 re-paid +1 day",
        timeframe: "March 2026",
      },
    },
    {
      id: "dec-004",
      recommendationId: "rec-prev-05",
      recommendationTitle: "Vertex Tech Q1 Saudization corrective action",
      decisionType: "rejected",
      decidedBy: "Compliance Officer",
      role: "compliance-officer",
      timestamp: "2026-03-10T10:45:00Z",
      rationale: "Premature — re-evaluate at April cycle close.",
      simulatedOutcome: {
        cost: "0 SAR action cost",
        compliance: "Q1 review locked Yellow band — re-decided as approved in April",
        sla: "Re-evaluated 1 Apr",
        timeframe: "Q1 → Q2 2026",
      },
    },
    {
      id: "dec-005",
      recommendationId: "rec-prev-04",
      recommendationTitle: "Aisha Al-Harbi maternity leave approval",
      decisionType: "approved",
      decidedBy: "Payroll Manager",
      role: "payroll-manager",
      timestamp: "2026-04-22T08:30:00Z",
      rationale: "Documents complete; eligibility confirmed under Article 151.",
      simulatedOutcome: {
        cost: "SAR 25,667 paid leave (May–Jul)",
        compliance: "Compliant with Article 151",
        sla: "Confirmed within 24h of request",
        timeframe: "May–Jul 2026",
      },
    },
    {
      id: "dec-006",
      recommendationId: "rec-prev-03",
      recommendationTitle: "Khalid Al-Otaibi GOSI registration",
      decisionType: "approved",
      decidedBy: "Compliance Officer",
      role: "compliance-officer",
      timestamp: "2026-03-12T16:00:00Z",
      rationale: "New hire on probation; GOSI must be registered within 15 days of hire date.",
      simulatedOutcome: {
        cost: "SAR 775/mo employee+employer contribution",
        compliance: "Registered day 12 of 15-day window",
        sla: "Within mandatory 15-day window",
        timeframe: "From March 2026",
      },
    },
    {
      id: "dec-007",
      recommendationId: "rec-prev-02",
      recommendationTitle: "Fatima Al-Zahrani vacation salary advance",
      decisionType: "approved",
      decidedBy: "Payroll Manager",
      role: "payroll-manager",
      timestamp: "2026-04-18T10:00:00Z",
      rationale: "Standard advance per Article 109.",
      simulatedOutcome: {
        cost: "SAR 11,200 advance (offset against May payslip)",
        compliance: "Article 109 satisfied",
        sla: "Advance scheduled 5 May (5 business days before leave)",
        timeframe: "May 2026",
      },
    },
  ];
}

// ─── 7. Agent performance scores (per-agent scorecards) ─────────────────

export function generateAgentPerformanceScores(): AgentPerformanceScore[] {
  const data = safeData();
  const latest = data.agentPerformance.filter((p) => p.periodYear === 2026 && p.periodMonth === 4);
  const out: AgentPerformanceScore[] = [];

  for (const id of TASAMA_AGENT_IDS) {
    const cur = latest.find((p) => p.agentId === id);
    // Build last-6-month trend from agentPerformance, falling back to a healthy default.
    const trend = data.agentPerformance
      .filter((p) => p.agentId === id)
      .sort((a, b) => (a.periodYear - b.periodYear) * 12 + (a.periodMonth - b.periodMonth))
      .slice(-6)
      .map((p) => Math.round(p.composite * 100));
    const accuracy = Math.round((cur?.accuracy ?? 0.95) * 1000) / 10;
    const speed = Math.round((cur?.speed ?? 0.92) * 1000) / 10;
    const autonomy = Math.round((cur?.autonomy ?? 0.85) * 1000) / 10;
    const quality = Math.round((cur?.quality ?? 0.95) * 1000) / 10;
    const composite = Math.round((cur?.composite ?? 0.92) * 1000) / 10;
    const tasksThisCycle = cur?.tasksProcessed ?? 0;
    const errorCount = cur?.errorCount ?? 0;
    const overrides = cur?.humanOverrides ?? 0;
    const escalations = cur?.escalations ?? 0;
    const humanOverrideRate = tasksThisCycle ? Math.round((overrides / tasksThisCycle) * 1000) / 10 : 0;
    const escalationRate = tasksThisCycle ? Math.round((escalations / tasksThisCycle) * 1000) / 10 : 0;
    // Confidence calibration: derived from accuracy and override rate
    const confidenceCalibration = Math.max(0, Math.min(100, Math.round((accuracy - humanOverrideRate * 0.5) * 10) / 10));

    let health: AgentPerformanceScore["health"] = "healthy";
    if (composite < 88) health = "warning";
    else if (composite < 92 || speed < 80) health = "degraded";

    out.push({
      agentId: id,
      agentName: { en: getAgentName(id, "en"), ar: getAgentName(id, "ar") },
      health,
      accuracyScore: accuracy,
      speedScore: speed,
      autonomyScore: autonomy,
      qualityScore: quality,
      compositeScore: composite,
      trend: trend.length > 0 ? trend : [composite],
      tasksThisCycle,
      avgLatencySeconds: cur?.avgLatencySeconds ?? 1.2,
      errorCount,
      humanOverrideRate,
      escalationRate,
      confidenceCalibration,
      notableEvents: cur?.notableEvents ?? [],
    });
  }
  return out;
}

// ─── 8. Decision analytics (fleet-level) ────────────────────────────────

export function generateDecisionAnalytics(): DecisionAnalytics {
  const data = safeData();
  const decisions = generateDecisionHistory();

  const approved = decisions.filter((d) => d.decisionType === "approved").length;
  const modified = decisions.filter((d) => d.decisionType === "modified").length;
  const rejected = decisions.filter((d) => d.decisionType === "rejected").length;
  const total = decisions.length || 1;

  const byAgent = TASAMA_AGENT_IDS.map((id) => {
    const cur = data.agentPerformance.find((p) => p.agentId === id && p.periodYear === 2026 && p.periodMonth === 4);
    const tasks = cur?.tasksProcessed ?? 0;
    const overrides = cur?.humanOverrides ?? 0;
    const escalations = cur?.escalations ?? 0;
    const approvedCount = Math.max(0, tasks - overrides - escalations);
    return {
      agentId: id,
      agentName: getAgentName(id, "en"),
      approved: approvedCount,
      modified: Math.round(overrides * 0.6),
      rejected: Math.round(overrides * 0.4),
    };
  });

  const byRole: DecisionAnalytics["byRole"] = [
    { role: "payroll-manager", avgDecisionTimeMinutes: 18, approvalRate: 0.86 },
    { role: "finance-controller", avgDecisionTimeMinutes: 42, approvalRate: 0.78 },
    { role: "compliance-officer", avgDecisionTimeMinutes: 26, approvalRate: 0.82 },
  ];

  const topRejectionReasons: DecisionAnalytics["topRejectionReasons"] = [
    { reason: "Premature action — buffer remains adequate", count: 4 },
    { reason: "Awaiting upstream document confirmation", count: 3 },
    { reason: "Cost above approval threshold — re-scope", count: 2 },
    { reason: "Conflicting evidence — re-run reasoning", count: 2 },
    { reason: "Schedule conflict — defer to next cycle", count: 1 },
  ];

  const totalAgentTasks = data.agentPerformance
    .filter((p) => p.periodYear === 2026 && p.periodMonth === 4)
    .reduce((s, p) => s + p.tasksProcessed, 0);
  const totalOverrides = data.agentPerformance
    .filter((p) => p.periodYear === 2026 && p.periodMonth === 4)
    .reduce((s, p) => s + p.humanOverrides, 0);
  const automationRate = totalAgentTasks
    ? Math.round(((totalAgentTasks - totalOverrides) / totalAgentTasks) * 1000) / 10
    : 92.5;
  const humanTouchPointsPerCycle = data.clients.length * 3; // ~3 human checkpoints per client per cycle

  const confidenceCalibrationCurve: DecisionAnalytics["confidenceCalibrationCurve"] = [
    { bucket: "50-59%", predicted: 55, actual: 58 },
    { bucket: "60-69%", predicted: 65, actual: 67 },
    { bucket: "70-79%", predicted: 75, actual: 76 },
    { bucket: "80-89%", predicted: 85, actual: 84 },
    { bucket: "90-94%", predicted: 92, actual: 92 },
    { bucket: "95-100%", predicted: 98, actual: 97 },
  ];

  return {
    overallApprovalRate: Math.round((approved / total) * 1000) / 10,
    overallModificationRate: Math.round((modified / total) * 1000) / 10,
    overallRejectionRate: Math.round((rejected / total) * 1000) / 10,
    byAgent,
    byRole,
    topRejectionReasons,
    automationRate,
    humanTouchPointsPerCycle,
    confidenceCalibrationCurve,
  };
}

// ─── 9. Per-client AI insights (client portal) ─────────────────────────

export function generateClientAgentInsights(clientId: string): ClientAgentInsight[] {
  const data = safeData();
  const insights: ClientAgentInsight[] = [];
  const clientEmployees = data.employees.filter((e) => e.clientId === clientId);

  if (clientId === "client-alnakhla") {
    insights.push({
      id: "ins-ank-1",
      clientId,
      type: "action-required",
      title: "Mohammad Al-Ghamdi final settlement SAR 196,450 — Finance Controller approval pending",
      titleAr: "التسوية النهائية لمحمد الغامدي 196,450 ريال — في انتظار اعتماد المدير المالي",
      detail: "EOSB 166,250 + leave 10,500 + remaining April salary 19,700. Mudad transfer ready.",
      detailAr: "مكافأة نهاية الخدمة 166,250 + إجازة 10,500 + راتب أبريل المتبقي 19,700. التحويل عبر مُدد جاهز.",
      agentSource: "eosb-provision",
      confidence: 99,
      linkedEntityId: "emp-alnakhla-003",
      createdAt: isoDaysAgo(2),
    });
    insights.push({
      id: "ins-ank-2",
      clientId,
      type: "info",
      title: "Aisha Al-Harbi maternity leave starts 15 May 2026 — payroll impact SAR 11,000/month for 70 days",
      titleAr: "تبدأ إجازة أمومة عائشة الحربي في 15 مايو 2026 — تأثير الرواتب 11,000 ريال شهريًا لمدة 70 يومًا",
      detail: "Article 151 fully paid. Cover plan: existing junior coordinator absorbs admin.",
      detailAr: "المادة 151 مدفوعة بالكامل. خطة التغطية: المنسقة المبتدئة الحالية تتولى المهام الإدارية.",
      agentSource: "leave-management",
      confidence: 98,
      linkedEntityId: "emp-alnakhla-004",
      createdAt: isoDaysAgo(4),
    });
    insights.push({
      id: "ins-ank-3",
      clientId,
      type: "action-required",
      title: "Contract renewal due for Rajesh Kumar in 60 days — upload renewal letter to initiate processing",
      titleAr: "تجديد عقد راجيش كومار خلال 60 يومًا — حمّل خطاب التجديد لبدء المعالجة",
      detail: "2-year extension recommended; renewal letter (ANK-HR-2026-0418) prepared.",
      detailAr: "يوصى بتمديد لمدة سنتين؛ خطاب التجديد (ANK-HR-2026-0418) جاهز.",
      agentSource: "client-communications",
      confidence: 96,
      linkedEntityId: "emp-alnakhla-002",
      createdAt: isoDaysAgo(7),
    });
    insights.push({
      id: "ins-ank-4",
      clientId,
      type: "opportunity",
      title: "3 employees approaching overtime threshold (>45 hrs/week) — automated monitoring active",
      titleAr: "3 موظفين يقتربون من حد العمل الإضافي (>45 ساعة/أسبوع) — المراقبة الآلية نشطة",
      detail: "Site 9 high-rise project — recommend rotation or shift split to control cost.",
      detailAr: "مشروع موقع 9 — يُوصى بالتناوب أو تقسيم النوبات لضبط التكلفة.",
      agentSource: "performance-audit",
      confidence: 88,
      createdAt: isoHoursAgo(20),
    });
    insights.push({
      id: "ins-ank-5",
      clientId,
      type: "info",
      title: "Ahmed Al-Rashidi 2-month retroactive (SAR 4,600) included in April payslip",
      titleAr: "تسوية أحمد الرشيدي بأثر رجعي لشهرين (4,600 ريال) مدرجة في كشف رواتب أبريل",
      detail: "Promotion to Project Manager effective 1 Mar 2026; GOSI re-base auto-applied.",
      detailAr: "ترقية إلى مدير مشروع سارية من 1 مارس 2026؛ إعادة احتساب التأمينات تلقائيًا.",
      agentSource: "salary-calculation",
      confidence: 99,
      linkedEntityId: "emp-alnakhla-001",
      createdAt: isoHoursAgo(18),
    });
  }

  if (clientId === "client-luma") {
    insights.push({
      id: "ins-lmr-1",
      clientId,
      type: "info",
      title: "Khalid Al-Otaibi probation milestone in 30 days — confirmation letter pre-staged",
      titleAr: "مرحلة فترة تجربة خالد العتيبي خلال 30 يومًا — خطاب التثبيت معد مسبقًا",
      detail: "Performance to date: meets expectations. Schedule review meeting 25 May 2026.",
      detailAr: "الأداء حتى الآن: يلبي التوقعات. حدد اجتماع المراجعة في 25 مايو 2026.",
      agentSource: "client-communications",
      confidence: 88,
      linkedEntityId: "emp-luma-002",
      createdAt: isoHoursAgo(36),
    });
    insights.push({
      id: "ins-lmr-2",
      clientId,
      type: "action-required",
      title: "Fatima Al-Zahrani vacation salary advance SAR 11,200 — disburses 5 May 2026",
      titleAr: "سلفة الإجازة لفاطمة الزهراني 11,200 ريال — تُصرف في 5 مايو 2026",
      detail: "21-day annual leave from 10 May; Article 109 advance staged.",
      detailAr: "إجازة سنوية 21 يومًا من 10 مايو؛ سلفة المادة 109 مهيأة.",
      agentSource: "leave-management",
      confidence: 98,
      linkedEntityId: "emp-luma-001",
      createdAt: isoDaysAgo(8),
    });
    insights.push({
      id: "ins-lmr-3",
      clientId,
      type: "opportunity",
      title: "Saudization at 78.6% (Green-Mid) — within 1.4pp of Green-High band",
      titleAr: "السعودة عند 78.6% (أخضر متوسط) — على بُعد 1.4 نقطة مئوية من النطاق الأعلى",
      detail: "1 additional Saudi hire would unlock Green-High benefits and visa quota expansion.",
      detailAr: "تعيين سعودي إضافي واحد سيفتح مزايا الأخضر العالي وتوسيع حصة التأشيرات.",
      agentSource: "saudization-monitor",
      confidence: 91,
      createdAt: isoDaysAgo(2),
    });
  }

  if (clientId === "client-vertex") {
    insights.push({
      id: "ins-vtx-1",
      clientId,
      type: "risk",
      title: "Saudization in Yellow band — Q2 review on 1 Jul 2026; recovery plan in progress",
      titleAr: "السعودة في النطاق الأصفر — مراجعة الربع الثاني في 1 يوليو 2026؛ خطة التعافي قيد التنفيذ",
      detail: "+2 Saudi developer hires via HRDF Tamheer lifts ratio to 58.3% (Green-Low).",
      detailAr: "+2 مطور سعودي عبر برنامج تمهير يرفع النسبة إلى 58.3% (أخضر منخفض).",
      agentSource: "saudization-monitor",
      confidence: 86,
      createdAt: isoDaysAgo(2),
    });
    insights.push({
      id: "ins-vtx-2",
      clientId,
      type: "action-required",
      title: "Noura Al-Salem salary increase pending Finance Controller approval",
      titleAr: "زيادة راتب نورة السالم في انتظار اعتماد المدير المالي",
      detail: "SAR 15,000 → SAR 17,000 effective 1 May 2026; +SAR 27,360 annual cost.",
      detailAr: "15,000 → 17,000 ريال سارية من 1 مايو 2026؛ تكلفة سنوية إضافية 27,360 ريال.",
      agentSource: "salary-calculation",
      confidence: 94,
      linkedEntityId: "emp-vertex-001",
      createdAt: isoDaysAgo(1),
    });
    insights.push({
      id: "ins-vtx-3",
      clientId,
      type: "info",
      title: "Sarah Johnson Q1 performance bonus SAR 15,000 paid in April",
      titleAr: "صرف مكافأة أداء سارة جونسون للربع الأول 15,000 ريال في أبريل",
      detail: "OHRP-only base (non-Saudi) — no GOSI annuity impact.",
      detailAr: "قاعدة الأخطار المهنية فقط (غير سعودية) — لا تأثير على معاش التأمينات.",
      agentSource: "salary-calculation",
      confidence: 99,
      linkedEntityId: "emp-vertex-002",
      createdAt: isoDaysAgo(11),
    });
  }

  // Universal insights from data
  if (clientEmployees.length > 0) {
    insights.push({
      id: `ins-${clientId}-perf`,
      clientId,
      type: "info",
      title: `Document extraction average confidence: 98% across last 12 documents`,
      titleAr: `متوسط ثقة استخراج الوثائق: 98% عبر آخر 12 وثيقة`,
      detail: "All field-level confidence scores exceeded 0.95 threshold. No human verification queue formed.",
      detailAr: "تجاوزت جميع درجات ثقة الحقول عتبة 0.95. لم تتشكل قائمة انتظار للمراجعة البشرية.",
      agentSource: "document-intelligence",
      confidence: 95,
      createdAt: isoHoursAgo(20),
    });
  }

  return insights;
}

// ─── 10. Simulator recommendations (manager dashboard simulator) ────────

export function generatePayrollSimulatorRecommendations(): SimulatorRecommendation[] {
  return [
    {
      id: "sim-rec-001",
      title: "Hire 2 Saudi developers at Vertex Tech to exit Yellow band",
      description: "Recommended by Compliance & Audit Agent based on Q1 2026 Nitaqat review. Lifts ratio from 50% to 58.3%, exiting Yellow band into Green-Low.",
      suggestedMode: "headcount",
      suggestedParams: {
        clientId: "client-vertex",
        action: "hire",
        count: 2,
        nationality: "saudi",
        averageSalary: 12000,
      },
      impact: "Saudization improves from 50% to 58.3% — exits Yellow band; Iqama issuance freeze risk cleared.",
      confidence: 94,
      agentSource: "Saudization Monitor + Compliance Agent",
    },
    {
      id: "sim-rec-002",
      title: "Apply Noura Al-Salem salary increase (SAR 15,000 → SAR 17,000)",
      description: "Salary Calculation Agent recommends modelling the pending increase to forecast May 2026 GOSI costs and Vertex Tech monthly run.",
      suggestedMode: "salary",
      suggestedParams: {
        clientId: "client-vertex",
        employeeId: "emp-vertex-001",
        currentBasic: 15000,
        newBasic: 17000,
        effectiveDate: "2026-05-01",
      },
      impact: "+SAR 2,280/mo employer cost (basic + GOSI re-base); 9% retention-risk reduction.",
      confidence: 97,
      agentSource: "Salary Calculation Agent",
    },
    {
      id: "sim-rec-003",
      title: "Model GOSI rate increase to 13% — 2027 policy review pending",
      description: "GOSI Compliance Agent flagged a published consultation on raising annuity rate by 1pp. Model fleet-wide cost impact ahead of next cycle.",
      suggestedMode: "compliance",
      suggestedParams: {
        scenario: "gosi-rate-change",
        currentRate: 0.12,
        newRate: 0.13,
        effectiveDate: "2027-01-01",
      },
      impact: "Fleet GOSI cost +SAR 4,475/month (+8.3%); Saudi-employee employer contribution rises proportionally.",
      confidence: 82,
      agentSource: "GOSI Compliance Agent",
    },
    {
      id: "sim-rec-004",
      title: "Promote 1 internal Saudi engineer at Vertex (alternative to external hire)",
      description: "Saudization Monitor proposes an alternative path: promote 1 internal Saudi engineer + hire 1 fresh Saudi grad — same band move, lower headcount cost.",
      suggestedMode: "headcount",
      suggestedParams: {
        clientId: "client-vertex",
        action: "hire",
        count: 1,
        nationality: "saudi",
        averageSalary: 9000,
      },
      impact: "Saudization → 54.5% (Yellow → Green-Low borderline); cost SAR 9,000/mo vs SAR 24,000 for 2 senior hires.",
      confidence: 79,
      agentSource: "Saudization Monitor + Compensation Agent",
    },
    {
      id: "sim-rec-005",
      title: "Model 8% across-the-board increase at Al-Nakhla (post-settlement)",
      description: "Following Mohammad Al-Ghamdi separation, Salary Calculation Agent suggests modelling a retention sweep for Al-Nakhla.",
      suggestedMode: "salary",
      suggestedParams: {
        clientId: "client-alnakhla",
        scope: "all",
        increasePercent: 8,
        effectiveDate: "2026-06-01",
      },
      impact: "+SAR 18,240/mo basic + SAR 2,189 GOSI re-base; total annual SAR 245K incremental.",
      confidence: 76,
      agentSource: "Salary Calculation Agent",
    },
    {
      id: "sim-rec-006",
      title: "Forecast Q2 2026 Saudization for Luma Retail (Green-Mid → Green-High)",
      description: "Saudization Monitor: 1 additional Saudi hire would unlock Green-High band benefits.",
      suggestedMode: "headcount",
      suggestedParams: {
        clientId: "client-luma",
        action: "hire",
        count: 1,
        nationality: "saudi",
        averageSalary: 7000,
      },
      impact: "Saudization 78.6% → 80.0% (Green-High); unlocks expanded visa quota.",
      confidence: 91,
      agentSource: "Saudization Monitor",
    },
  ];
}

// ─── 11. Employee processes (per-client process instances) ─────────────

export function generateEmployeeProcesses(clientId: string): EmployeeProcess[] {
  const data = safeData();
  const processes: EmployeeProcess[] = [];
  const employees = data.employees.filter((e) => e.clientId === clientId);
  const findEmp = (id: string) => employees.find((e) => e.id === id);

  if (clientId === "client-alnakhla") {
    const mohammad = findEmp("emp-alnakhla-003");
    if (mohammad) {
      processes.push({
        id: "proc-mohammad-separation",
        type: "separation",
        clientId,
        employeeId: mohammad.id,
        employeeName: { en: mohammad.fullNameEn, ar: mohammad.fullNameAr },
        startedAt: "2026-04-10",
        estimatedCompletion: "2026-05-05",
        steps: separationSteps(),
        activityLog: [
          { timestamp: isoHoursAgo(8), agentName: "EOSB Provision Agent", description: "Computed final EOSB", outcome: "SAR 166,250" },
          { timestamp: isoHoursAgo(20), agentName: "Leave Management Agent", description: "Computed leave encashment", outcome: "18 days × 583.33 = SAR 10,500" },
          { timestamp: isoHoursAgo(36), agentName: "Salary Calculation Agent", description: "Computed remaining April salary", outcome: "SAR 19,700" },
          { timestamp: isoDaysAgo(3), agentName: "Document Intelligence Agent", description: "Processed termination letter", outcome: "Mutual agreement, 0.98 confidence" },
        ],
      });
    }
    const aisha = findEmp("emp-alnakhla-004");
    if (aisha) {
      processes.push({
        id: "proc-aisha-maternity",
        type: "maternity-leave",
        clientId,
        employeeId: aisha.id,
        employeeName: { en: aisha.fullNameEn, ar: aisha.fullNameAr },
        startedAt: "2026-04-15",
        estimatedCompletion: "2026-07-24",
        steps: maternitySteps(),
        activityLog: [
          { timestamp: isoDaysAgo(4), agentName: "Document Intelligence Agent", description: "Processed maternity approval", outcome: "70 days, 0.99 confidence" },
          { timestamp: isoDaysAgo(4), agentName: "Leave Management Agent", description: "Updated leave balance", outcome: "Maternity entry created" },
        ],
      });
    }
    const rajesh = findEmp("emp-alnakhla-002");
    if (rajesh) {
      processes.push({
        id: "proc-rajesh-iqama",
        type: "iqama-renewal",
        clientId,
        employeeId: rajesh.id,
        employeeName: { en: rajesh.fullNameEn, ar: rajesh.fullNameAr },
        startedAt: "2026-04-18",
        estimatedCompletion: "2026-07-15",
        steps: iqamaRenewalSteps(),
        activityLog: [
          { timestamp: isoDaysAgo(7), agentName: "Compliance Agent", description: "Pre-staged renewal documents", outcome: "Ready for 15 May submission window" },
        ],
      });
    }
  }

  if (clientId === "client-luma") {
    const khalid = findEmp("emp-luma-002");
    if (khalid) {
      processes.push({
        id: "proc-khalid-onboarding",
        type: "onboarding",
        clientId,
        employeeId: khalid.id,
        employeeName: { en: khalid.fullNameEn, ar: khalid.fullNameAr },
        startedAt: "2026-03-01",
        estimatedCompletion: "2026-05-30",
        steps: onboardingSteps(),
        activityLog: [
          { timestamp: isoDaysAgo(45), agentName: "Document Intelligence Agent", description: "Processed employment contract", outcome: "0.98 confidence" },
          { timestamp: isoDaysAgo(44), agentName: "GOSI Compliance Agent", description: "Registered GOSI subscription", outcome: "G-2026-LMR-007" },
          { timestamp: isoDaysAgo(30), agentName: "Salary Calculation Agent", description: "First payslip (March)", outcome: "Pro-rata SAR 6,250" },
        ],
      });
    }
  }

  if (clientId === "client-vertex") {
    const noura = findEmp("emp-vertex-001");
    if (noura) {
      processes.push({
        id: "proc-noura-salary",
        type: "salary-adjustment",
        clientId,
        employeeId: noura.id,
        employeeName: { en: noura.fullNameEn, ar: noura.fullNameAr },
        startedAt: "2026-04-20",
        estimatedCompletion: "2026-05-25",
        steps: salaryAdjustmentSteps(),
        activityLog: [
          { timestamp: isoDaysAgo(6), agentName: "Document Intelligence Agent", description: "Processed salary increase letter", outcome: "13.3% increase, 0.98 confidence" },
          { timestamp: isoDaysAgo(5), agentName: "Salary Calculation Agent", description: "Computed GOSI re-base", outcome: "+SAR 280/mo employer GOSI" },
        ],
      });
    }
  }

  return processes;
}

// ─── Step templates for processes ──────────────────────────────────────

function separationSteps(): ProcessStep[] {
  return [
    { id: "s1", name: "Process termination letter", nameAr: "معالجة خطاب الإنهاء", agentId: "document-intelligence", agentName: "Document Intelligence Agent", status: "completed", completedAt: "2026-04-10", output: "Mutual agreement, 30-day notice served" },
    { id: "s2", name: "Compute EOSB", nameAr: "احتساب مكافأة نهاية الخدمة", agentId: "eosb-provision", agentName: "EOSB Provision Agent", status: "completed", completedAt: "2026-04-12", output: "SAR 166,250" },
    { id: "s3", name: "Compute leave encashment", nameAr: "احتساب صرف الإجازة", agentId: "leave-management", agentName: "Leave Management Agent", status: "completed", completedAt: "2026-04-13", output: "SAR 10,500" },
    { id: "s4", name: "Compute remaining salary", nameAr: "احتساب الراتب المتبقي", agentId: "salary-calculation", agentName: "Salary Calculation Agent", status: "completed", completedAt: "2026-04-14", output: "SAR 19,700" },
    { id: "s5", name: "Generate settlement statement", nameAr: "إنشاء كشف التسوية", agentId: "document-intelligence", agentName: "Document Intelligence Agent", status: "completed", completedAt: "2026-04-26", output: "Final settlement PDF (doc-012)" },
    { id: "s6", name: "Finance Controller approval", nameAr: "اعتماد المدير المالي", agentId: "human-checkpoint", agentName: "Finance Controller", status: "active" },
    { id: "s7", name: "Mudad final WPS transfer", nameAr: "تحويل مُدد النهائي", agentId: "mudad-bank-transfer", agentName: "Mudad & Bank Transfer Agent", status: "pending" },
    { id: "s8", name: "Issue experience letter", nameAr: "إصدار شهادة خبرة", agentId: "client-communications", agentName: "Client Communications Agent", status: "pending" },
  ];
}

function onboardingSteps(): ProcessStep[] {
  return [
    { id: "o1", name: "Process employment contract", nameAr: "معالجة عقد العمل", agentId: "document-intelligence", agentName: "Document Intelligence Agent", status: "completed", completedAt: "2026-03-01", output: "0.98 confidence" },
    { id: "o2", name: "Register GOSI subscription", nameAr: "تسجيل اشتراك التأمينات", agentId: "gosi-compliance", agentName: "GOSI Compliance Agent", status: "completed", completedAt: "2026-03-12", output: "G-2026-LMR-007" },
    { id: "o3", name: "Process first payslip", nameAr: "معالجة أول كشف راتب", agentId: "salary-calculation", agentName: "Salary Calculation Agent", status: "completed", completedAt: "2026-03-25", output: "Pro-rata SAR 6,250" },
    { id: "o4", name: "Probation milestone review", nameAr: "مراجعة مرحلة فترة التجربة", agentId: "human-checkpoint", agentName: "Payroll Manager", status: "active" },
    { id: "o5", name: "Confirmation letter", nameAr: "خطاب التثبيت", agentId: "client-communications", agentName: "Client Communications Agent", status: "pending" },
    { id: "o6", name: "Activate full benefits", nameAr: "تفعيل المزايا الكاملة", agentId: "payroll-orchestrator", agentName: "Payroll Orchestrator", status: "pending" },
  ];
}

function salaryAdjustmentSteps(): ProcessStep[] {
  return [
    { id: "a1", name: "Process salary increase letter", nameAr: "معالجة خطاب الزيادة", agentId: "document-intelligence", agentName: "Document Intelligence Agent", status: "completed", completedAt: "2026-04-20", output: "0.98 confidence" },
    { id: "a2", name: "Compute GOSI re-base", nameAr: "إعادة احتساب التأمينات", agentId: "salary-calculation", agentName: "Salary Calculation Agent", status: "completed", completedAt: "2026-04-21", output: "+SAR 280/mo employer GOSI" },
    { id: "a3", name: "Model annual cost impact", nameAr: "نموذج التأثير السنوي للتكلفة", agentId: "salary-calculation", agentName: "Salary Calculation Agent", status: "completed", completedAt: "2026-04-22", output: "+SAR 27,360 annual" },
    { id: "a4", name: "Finance Controller approval", nameAr: "اعتماد المدير المالي", agentId: "human-checkpoint", agentName: "Finance Controller", status: "active" },
    { id: "a5", name: "Apply in May 2026 payslip", nameAr: "التطبيق في كشف رواتب مايو 2026", agentId: "salary-calculation", agentName: "Salary Calculation Agent", status: "pending" },
  ];
}

function maternitySteps(): ProcessStep[] {
  return [
    { id: "m1", name: "Process maternity approval", nameAr: "معالجة اعتماد الأمومة", agentId: "document-intelligence", agentName: "Document Intelligence Agent", status: "completed", completedAt: "2026-04-22", output: "70 days, 0.99 confidence" },
    { id: "m2", name: "Update leave balance", nameAr: "تحديث رصيد الإجازة", agentId: "leave-management", agentName: "Leave Management Agent", status: "completed", completedAt: "2026-04-22", output: "Maternity entry added" },
    { id: "m3", name: "Stage May–Jul payslip cycles", nameAr: "تهيئة دورات رواتب مايو–يوليو", agentId: "payroll-orchestrator", agentName: "Payroll Orchestrator", status: "active" },
    { id: "m4", name: "Issue maternity confirmation letter", nameAr: "إصدار خطاب تأكيد الأمومة", agentId: "client-communications", agentName: "Client Communications Agent", status: "pending" },
  ];
}

function iqamaRenewalSteps(): ProcessStep[] {
  return [
    { id: "i1", name: "Pre-stage renewal documents", nameAr: "تجهيز مستندات التجديد", agentId: "client-communications", agentName: "Client Communications Agent", status: "completed", completedAt: "2026-04-19", output: "Documents queued for 15 May submission" },
    { id: "i2", name: "Submit Absher renewal request", nameAr: "تقديم طلب التجديد عبر أبشر", agentId: "human-checkpoint", agentName: "Compliance Officer", status: "pending" },
    { id: "i3", name: "Pay renewal fee", nameAr: "دفع رسوم التجديد", agentId: "mudad-bank-transfer", agentName: "Mudad & Bank Transfer Agent", status: "pending" },
    { id: "i4", name: "Update Muqeem registry", nameAr: "تحديث سجل مقيم", agentId: "gosi-compliance", agentName: "GOSI Compliance Agent", status: "pending" },
    { id: "i5", name: "Confirm renewal with employee", nameAr: "تأكيد التجديد مع الموظف", agentId: "client-communications", agentName: "Client Communications Agent", status: "pending" },
  ];
}

// ─── 12. Quick stats for dashboards ────────────────────────────────────

export function generateQuickStats(_lang: Lang = "en") {
  const data = safeData();
  const totalGross = data.payrollRuns
    .filter((r) => r.periodYear === 2026 && r.periodMonth === 4)
    .reduce((s, r) => s + r.totalGross, 0);
  const totalGosi = data.payrollRuns
    .filter((r) => r.periodYear === 2026 && r.periodMonth === 4)
    .reduce((s, r) => s + r.totalGosiEmployer + r.totalGosiEmployee, 0);
  const openRequests = data.serviceRequests.filter(
    (r) => r.status === "submitted" || r.status === "in-progress" || r.status === "in-review",
  ).length;
  const upcomingEvents = data.regulatoryCalendar.filter((c) => c.type === "upcoming").length;
  return {
    clientCount: data.clients.length,
    employeeCount: data.employees.length,
    monthlyGross: totalGross,
    monthlyGosi: totalGosi,
    openRequests,
    upcomingEvents,
    activeAgents: TASAMA_AGENT_IDS.length,
    avgConfidence: data.documents.length
      ? +(data.documents.reduce((s, d) => s + d.overallConfidence, 0) / data.documents.length).toFixed(3)
      : 0,
  };
}

// ─── 13. What-if simulator ─────────────────────────────────────────────

export interface SimulatorInput {
  saudiHires?: number;
  expatHires?: number;
  saudiSeparations?: number;
  expatSeparations?: number;
  salaryIncreasePct?: number;
}

export interface SimulatorOutput {
  newHeadcount: number;
  newSaudization: number;
  newBand: string;
  newMonthlyGross: number;
  newGosiCost: number;
  warnings: string[];
}

export function runSimulator(input: SimulatorInput, clientId?: string): SimulatorOutput {
  const data = safeData();
  const employees = clientId ? data.employees.filter((e) => e.clientId === clientId) : data.employees;
  const saudiHires = input.saudiHires ?? 0;
  const expatHires = input.expatHires ?? 0;
  const saudiSeps = input.saudiSeparations ?? 0;
  const expatSeps = input.expatSeparations ?? 0;
  const newSaudi = employees.filter((e) => e.isSaudi).length + saudiHires - saudiSeps;
  const newExpat = employees.filter((e) => !e.isSaudi).length + expatHires - expatSeps;
  const total = newSaudi + newExpat;
  const ratio = total > 0 ? (newSaudi / total) * 100 : 0;
  const band = ratio >= 60 ? "green-high" : ratio >= 40 ? "green-mid" : ratio >= 30 ? "yellow" : "red";

  const monthlyGross = data.salaryComponents
    .filter((s) => employees.some((e) => e.id === s.employeeId))
    .reduce((sum, s) => sum + s.grossMonthly, 0);
  const inc = (input.salaryIncreasePct ?? 0) / 100;
  const newMonthlyGross = Math.round(monthlyGross * (1 + inc) + (saudiHires + expatHires) * 8500 - (saudiSeps + expatSeps) * 8500);

  let totalGosi = 0;
  for (const s of data.salaryComponents) {
    const emp = employees.find((e) => e.id === s.employeeId);
    if (!emp) continue;
    const basicHousing = (s.basicSalary + s.housingAllowance) * (1 + inc);
    const g = computeGosi(basicHousing, emp.isSaudi);
    totalGosi += g.totalEmployer + g.totalEmployee;
  }
  totalGosi += (saudiHires * 0.22 + expatHires * 0.02) * 8000;

  const warnings: string[] = [];
  if (band === "yellow") warnings.push("Saudization drops to Yellow — Iqama issuance freeze risk.");
  if (band === "red") warnings.push("Saudization drops to Red — fines and visa restrictions.");
  if (inc > 0.15) warnings.push("Salary increase >15% — Finance Controller approval required.");
  if (newMonthlyGross > monthlyGross * 1.3) warnings.push("Payroll cost up >30% — review with CFO before committing.");

  return {
    newHeadcount: total,
    newSaudization: +ratio.toFixed(1),
    newBand: band,
    newMonthlyGross,
    newGosiCost: Math.round(totalGosi),
    warnings,
  };
}

// ─── 14. Per-client summaries ──────────────────────────────────────────

export interface ClientSummary {
  client: TasamaClient;
  employeeCount: number;
  saudiCount: number;
  expatCount: number;
  saudizationPercent: number;
  monthlyGross: number;
  monthlyGosi: number;
  pendingRequests: number;
  upcomingEvents: number;
  latestRunStatus: PayrollRun["status"] | "—";
}

export function generateClientSummaries(): ClientSummary[] {
  const data = safeData();
  return data.clients.map((c) => {
    const employees = data.employees.filter((e) => e.clientId === c.id);
    const monthlyGross = data.salaryComponents
      .filter((s) => employees.some((e) => e.id === s.employeeId))
      .reduce((sum, s) => sum + s.grossMonthly, 0);
    const lastRun = data.payrollRuns
      .filter((r) => r.clientId === c.id)
      .sort((a, b) => (b.periodYear - a.periodYear) * 12 + (b.periodMonth - a.periodMonth))[0];
    const monthlyGosi = lastRun ? lastRun.totalGosiEmployer + lastRun.totalGosiEmployee : 0;
    const pendingRequests = data.serviceRequests.filter(
      (r) => r.clientId === c.id && (r.status === "submitted" || r.status === "in-progress" || r.status === "in-review"),
    ).length;
    const upcomingEvents = data.regulatoryCalendar.filter((cal) => cal.clientId === c.id && cal.type === "upcoming").length;
    return {
      client: c,
      employeeCount: employees.length,
      saudiCount: employees.filter((e) => e.isSaudi).length,
      expatCount: employees.filter((e) => !e.isSaudi).length,
      saudizationPercent: c.saudizationPercent,
      monthlyGross,
      monthlyGosi,
      pendingRequests,
      upcomingEvents,
      latestRunStatus: lastRun?.status ?? "—",
    };
  });
}

// ─── 15. Operations digest ─────────────────────────────────────────────

export interface OperationsDigest {
  headline: string;
  bullets: string[];
  generatedAt: string;
}

export function generateOperationsDigest(): OperationsDigest {
  const stats = generateQuickStats();
  return {
    headline: `${stats.clientCount} clients, ${stats.employeeCount} employees, ${formatSAR(stats.monthlyGross)} processed for April 2026.`,
    bullets: [
      `Average document extraction confidence: ${(stats.avgConfidence * 100).toFixed(1)}%.`,
      `${stats.openRequests} open service requests across all clients.`,
      `${stats.upcomingEvents} regulatory deadlines in the next 90 days.`,
      `All ${stats.activeAgents} specialist agents healthy this cycle.`,
      `Total GOSI contribution this month: ${formatSAR(stats.monthlyGosi)}.`,
    ],
    generatedAt: NOW.toISOString(),
  };
}

// ─── 16. Backwards-compatible aliases (old names) ──────────────────────
//
// Existing demo shells imported the old names — keep them as aliases so we
// don't break the React tree while the wider rebuild is in flight.

export const generateRecommendations = generatePayrollRecommendations;
export const generateAlerts = generatePayrollAlerts;
export const generateTasks = generatePayrollTasks;
export const generateActivityFeed = generateActivityLog;
export const generatePlaybooks = (): PayrollPlaybook[] => PAYROLL_PLAYBOOKS;
export const generateDecisionLog = generateDecisionHistory;
export const generateAgentScorecards = generateAgentPerformanceScores;

// Old type aliases (so AgentRecommendation imports keep working)
export type AgentRecommendation = PayrollRecommendation;
export type AgentAlert = PayrollAlert;
export type AgentTask = PayrollTask;
export type AgentPlaybook = PayrollPlaybook;
export type AgentActivityEntry = PayrollActivityEntry;
export type AgentDecisionLog = PayrollDecisionLog;
export type AgentScorecard = AgentPerformanceScore;
export type ManagerRole = PayrollRole;
