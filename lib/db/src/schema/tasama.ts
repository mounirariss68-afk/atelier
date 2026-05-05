import {
  pgTable,
  text,
  jsonb,
  timestamp,
  doublePrecision,
  integer,
  boolean,
  index,
} from "drizzle-orm/pg-core";

export const tasamaClientsTable = pgTable("tasama_clients", {
  id: text("id").primaryKey(),
  legalNameEn: text("legal_name_en").notNull(),
  legalNameAr: text("legal_name_ar").notNull(),
  industry: text("industry").notNull(),
  employeeCount: integer("employee_count").notNull(),
  saudiCount: integer("saudi_count").notNull(),
  expatCount: integer("expat_count").notNull(),
  saudizationBand: text("saudization_band").notNull(),
  saudizationPercent: doublePrecision("saudization_percent").notNull(),
  monthlyPayrollGross: integer("monthly_payroll_gross").notNull(),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  activeEvents: jsonb("active_events").notNull().$type<string[]>(),
  onboardedAt: text("onboarded_at").notNull(),
  payrollCutoffDay: integer("payroll_cutoff_day").notNull().default(25),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const tasamaEmployeesTable = pgTable(
  "tasama_employees",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    fullNameEn: text("full_name_en").notNull(),
    fullNameAr: text("full_name_ar").notNull(),
    nationality: text("nationality").notNull(),
    isSaudi: boolean("is_saudi").notNull(),
    role: text("role").notNull(),
    roleAr: text("role_ar").notNull(),
    department: text("department").notNull(),
    hireDate: text("hire_date").notNull(),
    yearsOfService: doublePrecision("years_of_service").notNull(),
    status: text("status").notNull(),
    contractType: text("contract_type").notNull(),
    iqamaNumber: text("iqama_number"),
    nationalId: text("national_id"),
    iban: text("iban").notNull(),
    bankName: text("bank_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    storyTags: jsonb("story_tags").notNull().$type<string[]>(),
    notes: text("notes"),
  },
  (t) => [
    index("idx_tasama_emp_client").on(t.clientId),
    index("idx_tasama_emp_status").on(t.status),
    index("idx_tasama_emp_dept").on(t.department),
  ],
);

export const tasamaSalaryComponentsTable = pgTable(
  "tasama_salary_components",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id").notNull(),
    basicSalary: integer("basic_salary").notNull(),
    housingAllowance: integer("housing_allowance").notNull(),
    transportAllowance: integer("transport_allowance").notNull(),
    otherAllowances: jsonb("other_allowances").notNull().$type<{ label: string; labelAr: string; amount: number }[]>(),
    grossMonthly: integer("gross_monthly").notNull(),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
  },
  (t) => [index("idx_tasama_salary_emp").on(t.employeeId)],
);

export const tasamaPayrollRunsTable = pgTable(
  "tasama_payroll_runs",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    runDate: text("run_date").notNull(),
    status: text("status").notNull(), // "draft" | "approved" | "settled" | "filed"
    totalGross: integer("total_gross").notNull(),
    totalNet: integer("total_net").notNull(),
    totalGosiEmployer: integer("total_gosi_employer").notNull(),
    totalGosiEmployee: integer("total_gosi_employee").notNull(),
    employeeCount: integer("employee_count").notNull(),
    approvedBy: text("approved_by"),
    approvedAt: text("approved_at"),
    settledAt: text("settled_at"),
    mudadBatchRef: text("mudad_batch_ref"),
    notes: text("notes"),
  },
  (t) => [
    index("idx_tasama_run_client").on(t.clientId),
    index("idx_tasama_run_period").on(t.periodYear, t.periodMonth),
  ],
);

export const tasamaPayslipsTable = pgTable(
  "tasama_payslips",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    employeeId: text("employee_id").notNull(),
    clientId: text("client_id").notNull(),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    basicSalary: integer("basic_salary").notNull(),
    housingAllowance: integer("housing_allowance").notNull(),
    transportAllowance: integer("transport_allowance").notNull(),
    otherAllowances: integer("other_allowances").notNull(),
    overtime: integer("overtime").notNull().default(0),
    bonus: integer("bonus").notNull().default(0),
    retroAdjustment: integer("retro_adjustment").notNull().default(0),
    grossPay: integer("gross_pay").notNull(),
    gosiEmployeeDeduction: integer("gosi_employee_deduction").notNull(),
    otherDeductions: integer("other_deductions").notNull().default(0),
    netPay: integer("net_pay").notNull(),
    paymentStatus: text("payment_status").notNull(), // "pending" | "paid" | "rejected"
    paymentDate: text("payment_date"),
    mudadRef: text("mudad_ref"),
  },
  (t) => [
    index("idx_tasama_payslip_run").on(t.runId),
    index("idx_tasama_payslip_emp").on(t.employeeId),
    index("idx_tasama_payslip_client").on(t.clientId),
  ],
);

export const tasamaDocumentsTable = pgTable(
  "tasama_documents",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    employeeId: text("employee_id"),
    type: text("type").notNull(),
    titleEn: text("title_en").notNull(),
    titleAr: text("title_ar").notNull(),
    referenceNumber: text("reference_number").notNull(),
    issuedAt: text("issued_at").notNull(),
    signedByName: text("signed_by_name").notNull(),
    signedByTitle: text("signed_by_title").notNull(),
    language: text("language").notNull().default("bilingual"),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull().default("application/pdf"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    extractedFields: jsonb("extracted_fields").notNull().$type<Record<string, { value: string; confidence: number }>>(),
    overallConfidence: doublePrecision("overall_confidence").notNull(),
    storagePath: text("storage_path").notNull(),
    processedAt: text("processed_at").notNull(),
  },
  (t) => [
    index("idx_tasama_docs_client").on(t.clientId),
    index("idx_tasama_docs_emp").on(t.employeeId),
    index("idx_tasama_docs_type").on(t.type),
  ],
);

export const tasamaServiceRequestsTable = pgTable(
  "tasama_service_requests",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    employeeId: text("employee_id"),
    type: text("type").notNull(),
    titleEn: text("title_en").notNull(),
    titleAr: text("title_ar").notNull(),
    description: text("description").notNull(),
    descriptionAr: text("description_ar").notNull(),
    status: text("status").notNull(), // "submitted" | "in-review" | "in-progress" | "completed" | "rejected"
    priority: text("priority").notNull(),
    requestedBy: text("requested_by").notNull(),
    requestedAt: text("requested_at").notNull(),
    assignedAgent: text("assigned_agent"),
    completedAt: text("completed_at"),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    slaTargetHours: integer("sla_target_hours").notNull(),
  },
  (t) => [
    index("idx_tasama_sr_client").on(t.clientId),
    index("idx_tasama_sr_status").on(t.status),
  ],
);

export const tasamaGosiRecordsTable = pgTable(
  "tasama_gosi_records",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id").notNull(),
    clientId: text("client_id").notNull(),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    isSaudi: boolean("is_saudi").notNull(),
    basicPlusHousing: integer("basic_plus_housing").notNull(),
    employerAnnuity: integer("employer_annuity").notNull(),
    employeeAnnuity: integer("employee_annuity").notNull(),
    ohrpEmployer: integer("ohrp_employer").notNull(),
    totalEmployer: integer("total_employer").notNull(),
    totalEmployee: integer("total_employee").notNull(),
    filingStatus: text("filing_status").notNull(), // "draft" | "submitted" | "accepted" | "rejected"
    filedAt: text("filed_at"),
    filingReference: text("filing_reference"),
  },
  (t) => [
    index("idx_tasama_gosi_emp").on(t.employeeId),
    index("idx_tasama_gosi_period").on(t.periodYear, t.periodMonth),
  ],
);

export const tasamaLeaveBalancesTable = pgTable(
  "tasama_leave_balances",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id").notNull(),
    annualEntitlement: integer("annual_entitlement").notNull(),
    annualUsed: integer("annual_used").notNull(),
    annualRemaining: integer("annual_remaining").notNull(),
    sickUsedDays: integer("sick_used_days").notNull(),
    otherLeaveUsed: jsonb("other_leave_used").notNull().$type<Record<string, number>>(),
    pendingRequests: jsonb("pending_requests").notNull().$type<{ type: string; days: number; startDate: string }[]>(),
    asOfDate: text("as_of_date").notNull(),
  },
  (t) => [index("idx_tasama_leave_emp").on(t.employeeId)],
);

export const tasamaEosbProvisionsTable = pgTable(
  "tasama_eosb_provisions",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id").notNull(),
    clientId: text("client_id").notNull(),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    yearsOfService: doublePrecision("years_of_service").notNull(),
    lastBasicPlusHousing: integer("last_basic_plus_housing").notNull(),
    accruedThisMonth: integer("accrued_this_month").notNull(),
    cumulativeProvision: integer("cumulative_provision").notNull(),
    estimatedFullPayout: integer("estimated_full_payout").notNull(),
  },
  (t) => [
    index("idx_tasama_eosb_emp").on(t.employeeId),
    index("idx_tasama_eosb_period").on(t.periodYear, t.periodMonth),
  ],
);

export const tasamaRegulatoryCalendarTable = pgTable(
  "tasama_regulatory_calendar",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(), // "gosi-filing" | "mudad-submission" | "iqama-renewal" | "saudization-review" | "wps-deadline" | "tax-event"
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    clientId: text("client_id"),
    employeeId: text("employee_id"),
    dueDate: text("due_date").notNull(),
    type: text("type").notNull(), // "filed" | "upcoming"
    descriptionEn: text("description_en").notNull(),
    descriptionAr: text("description_ar").notNull(),
    referenceNumber: text("reference_number"),
    completedAt: text("completed_at"),
  },
  (t) => [
    index("idx_tasama_cal_due").on(t.dueDate),
    index("idx_tasama_cal_type").on(t.type),
  ],
);

export const tasamaAgentPerformanceTable = pgTable(
  "tasama_agent_performance",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    accuracy: doublePrecision("accuracy").notNull(),
    speed: doublePrecision("speed").notNull(),
    autonomy: doublePrecision("autonomy").notNull(),
    quality: doublePrecision("quality").notNull(),
    composite: doublePrecision("composite").notNull(),
    tasksProcessed: integer("tasks_processed").notNull(),
    humanOverrides: integer("human_overrides").notNull(),
    escalations: integer("escalations").notNull(),
    avgLatencySeconds: doublePrecision("avg_latency_seconds").notNull(),
    errorCount: integer("error_count").notNull(),
    notableEvents: jsonb("notable_events").notNull().$type<string[]>(),
  },
  (t) => [
    index("idx_tasama_perf_agent").on(t.agentId),
    index("idx_tasama_perf_period").on(t.periodYear, t.periodMonth),
  ],
);
