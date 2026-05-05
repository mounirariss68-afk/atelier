// Tasama Payroll Intelligence Hub — DB seeder.
//
// Loads scripts/src/tasama-baseline.json (3 clients + 8 named employees +
// 12 documents + 12 service requests + 12 calendar events, all set in the
// April 2026 narrative period) and:
//   - generates the remaining 34 generic employees deterministically so each
//     client matches its declared headcount and saudization split,
//   - derives salary components, leave balances and current-month EOSB from
//     each employee,
//   - computes 6 monthly payroll runs per client (Nov 2025 – Apr 2026) and
//     the resulting payslips and GOSI records,
//   - generates 60 agent performance records (10 agents x 6 months),
//   - reads the 12 generated PDFs from scripts/src/tasama-pdfs and stores
//     metadata + byte size against each document row.
//
// Run order:
//   1) pnpm --filter @workspace/db push
//   2) pnpm --filter @workspace/scripts run generate:tasama-pdfs
//   3) pnpm --filter @workspace/scripts run seed:tasama

import {
  db as realDb,
  tasamaClientsTable,
  tasamaEmployeesTable,
  tasamaSalaryComponentsTable,
  tasamaPayrollRunsTable,
  tasamaPayslipsTable,
  tasamaDocumentsTable,
  tasamaServiceRequestsTable,
  tasamaGosiRecordsTable,
  tasamaLeaveBalancesTable,
  tasamaEosbProvisionsTable,
  tasamaRegulatoryCalendarTable,
  tasamaAgentPerformanceTable,
  pool,
} from "@workspace/db";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = path.resolve(__dirname, "tasama-baseline.json");
const PDF_DIR = path.resolve(__dirname, "tasama-pdfs");

// --dry-run mode: parse baseline, generate derived data and print the row
// counts that would be inserted, but issue no writes against the database.
// Useful for verifying mathematical/contract changes without touching prod.
const DRY_RUN = process.argv.includes("--dry-run");

const dryDb = {
  insert: (_table: unknown) => ({
    values: async (_payload: unknown) => {
      /* no-op in dry-run */
    },
  }),
  execute: async (_sql: unknown) => {
    /* no-op in dry-run */
  },
};

const db = DRY_RUN ? (dryDb as unknown as typeof realDb) : realDb;
if (DRY_RUN) {
  console.log("[seed-tasama] DRY RUN — no database writes will be issued");
}

// ─── Type shims for baseline ─────────────────────────────────────────────

interface BaselineClient {
  id: string;
  legalNameEn: string;
  legalNameAr: string;
  industry: string;
  employeeCount: number;
  saudiCount: number;
  expatCount: number;
  saudizationBand: string;
  saudizationPercent: number;
  monthlyPayrollGross: number;
  contactName: string;
  contactEmail: string;
  activeEvents: string[];
  onboardedAt: string;
  payrollCutoffDay?: number;
}

interface BaselineEmployee {
  id: string;
  clientId: string;
  fullNameEn: string;
  fullNameAr: string;
  nationality: string;
  isSaudi: boolean;
  role: string;
  roleAr: string;
  department: string;
  hireDate: string;
  yearsOfService: number;
  status: "active" | "on-leave" | "probation" | "separated" | "onboarding";
  contractType: "limited" | "unlimited" | "probation";
  nationalId: string | null;
  iqamaNumber: string | null;
  iban: string;
  bankName: string;
  email: string;
  phone: string;
  basicSalary: number;
  housingAllowance: number;
  transportAllowance: number;
  otherAllowances: { label: string; labelAr: string; amount: number }[];
  storyTags: string[];
  notes: string | null;
}

interface BaselineDoc {
  id: string;
  clientId: string;
  employeeId: string | null;
  type: string;
  titleEn: string;
  titleAr: string;
  referenceNumber: string;
  issuedAt: string;
  signedByName: string;
  signedByTitle: string;
  filename: string;
  extractedFields: Record<string, { value: string; confidence: number }>;
  overallConfidence: number;
}

interface BaselineRequest {
  id: string;
  clientId: string;
  employeeId: string | null;
  type: string;
  titleEn: string;
  titleAr: string;
  description: string;
  descriptionAr: string;
  status: string;
  priority: string;
  requestedBy: string;
  requestedAt: string;
  assignedAgent: string | null;
  completedAt: string | null;
  payload: Record<string, unknown>;
  slaTargetHours: number;
}

interface BaselineCalEvent {
  id: string;
  eventType: string;
  nameEn: string;
  nameAr: string;
  clientId: string | null;
  employeeId: string | null;
  dueDate: string;
  type: string;
  descriptionEn: string;
  descriptionAr: string;
  referenceNumber: string | null;
  completedAt: string | null;
}

interface Baseline {
  asOfDate: string;
  clients: BaselineClient[];
  namedEmployees: BaselineEmployee[];
  documents: BaselineDoc[];
  serviceRequests: BaselineRequest[];
  regulatoryCalendar: BaselineCalEvent[];
}

// ─── Deterministic RNG ───────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(0x7a5a3a);
function pickFrom<T>(arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}
function intBetween(lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

// ─── Generic employee templates ──────────────────────────────────────────

const SAUDI_FIRST_M = ["Ahmad", "Bandar", "Fahad", "Hamad", "Ibrahim", "Majed", "Mishaal", "Nasser", "Saleh", "Sultan", "Talal", "Turki", "Waleed", "Ziyad"];
const SAUDI_FIRST_F = ["Aisha", "Asma", "Dalal", "Hala", "Hessa", "Lujain", "Maha", "Manal", "Nada", "Rana", "Shahad", "Wafa", "Yara"];
const SAUDI_LAST = ["Al-Anazi", "Al-Bishi", "Al-Dossary", "Al-Enazi", "Al-Ghamdi", "Al-Harthi", "Al-Juhani", "Al-Khalifa", "Al-Mutairi", "Al-Qahtani", "Al-Rasheed", "Al-Subaie", "Al-Tamimi", "Al-Zahrani"];
const SAUDI_LAST_AR: Record<string, string> = {
  "Al-Anazi": "العنزي", "Al-Bishi": "البيشي", "Al-Dossary": "الدوسري", "Al-Enazi": "العنزي",
  "Al-Ghamdi": "الغامدي", "Al-Harthi": "الحارثي", "Al-Juhani": "الجهني", "Al-Khalifa": "الخليفة",
  "Al-Mutairi": "المطيري", "Al-Qahtani": "القحطاني", "Al-Rasheed": "الراشد", "Al-Subaie": "السبيعي",
  "Al-Tamimi": "التميمي", "Al-Zahrani": "الزهراني",
};
const ARABIC_FIRST_M: Record<string, string> = {
  Ahmad: "أحمد", Bandar: "بندر", Fahad: "فهد", Hamad: "حمد", Ibrahim: "إبراهيم", Majed: "ماجد",
  Mishaal: "مشعل", Nasser: "ناصر", Saleh: "صالح", Sultan: "سلطان", Talal: "طلال", Turki: "تركي",
  Waleed: "وليد", Ziyad: "زياد",
};
const ARABIC_FIRST_F: Record<string, string> = {
  Aisha: "عائشة", Asma: "أسماء", Dalal: "دلال", Hala: "هلا", Hessa: "حصة", Lujain: "لجين",
  Maha: "مها", Manal: "منال", Nada: "ندى", Rana: "رنا", Shahad: "شهد", Wafa: "وفاء", Yara: "يارا",
};

const EXPAT_PROFILES = [
  { nat: "indian", first: ["Rajesh", "Anil", "Suresh", "Vikram", "Arjun", "Deepak", "Sanjay", "Rahul", "Manoj", "Pradeep"], last: ["Patel", "Sharma", "Kumar", "Singh", "Reddy", "Nair", "Iyer", "Gupta"] },
  { nat: "pakistani", first: ["Imran", "Asad", "Bilal", "Faisal", "Hassan", "Junaid", "Kamran", "Nadeem", "Sajid", "Tariq"], last: ["Ahmed", "Khan", "Malik", "Sheikh", "Hussain", "Qureshi"] },
  { nat: "egyptian", first: ["Mahmoud", "Mostafa", "Karim", "Sherif", "Tamer", "Wael", "Yasser"], last: ["Mansour", "Hassan", "Aboud", "Farid", "Hamdy", "Said"] },
  { nat: "filipino", first: ["Jose", "Mark", "Paolo", "Renato", "Andres", "Felipe", "Lito"], last: ["Santos", "Cruz", "Reyes", "Garcia", "Lopez", "Mendoza"] },
  { nat: "jordanian", first: ["Khaled", "Samer", "Bashar", "Rami", "Zaid"], last: ["Abu-Daoud", "Al-Khatib", "Hijazi", "Nasrallah"] },
  { nat: "syrian", first: ["Anas", "Bashir", "Hamza", "Mazen"], last: ["Al-Halabi", "Al-Shami", "Al-Dimashqi"] },
  { nat: "sudanese", first: ["Mohamed", "Osman", "Bashir"], last: ["Al-Mahdi", "Hamid", "Al-Tayeb"] },
];

const ROLES: Record<string, { en: string; ar: string; dept: string; band: [number, number] }[]> = {
  construction: [
    { en: "Civil Engineer", ar: "مهندس مدني", dept: "engineering", band: [9000, 12000] },
    { en: "Site Supervisor", ar: "مشرف موقع", dept: "construction", band: [6500, 9000] },
    { en: "Foreman", ar: "رئيس عمال", dept: "construction", band: [5500, 7500] },
    { en: "Heavy Equipment Operator", ar: "مشغل معدات ثقيلة", dept: "construction", band: [5000, 7000] },
    { en: "Quantity Surveyor", ar: "مساح كميات", dept: "engineering", band: [7000, 10000] },
    { en: "Safety Officer", ar: "مسؤول السلامة", dept: "operations", band: [6500, 9500] },
    { en: "Procurement Officer", ar: "مسؤول مشتريات", dept: "operations", band: [6000, 9000] },
    { en: "Accountant", ar: "محاسب", dept: "finance", band: [6500, 9500] },
    { en: "HR Officer", ar: "مسؤول موارد بشرية", dept: "hr", band: [6000, 9000] },
    { en: "Driver", ar: "سائق", dept: "operations", band: [4000, 5500] },
  ],
  retail: [
    { en: "Sales Associate", ar: "مساعد مبيعات", dept: "sales", band: [4500, 6500] },
    { en: "Cashier", ar: "أمين صندوق", dept: "retail", band: [4000, 5500] },
    { en: "Floor Supervisor", ar: "مشرف معرض", dept: "retail", band: [6000, 8500] },
    { en: "Visual Merchandiser", ar: "مصمم عرض بضائع", dept: "retail", band: [5500, 7500] },
    { en: "Buyer", ar: "مشتري", dept: "operations", band: [8000, 11000] },
    { en: "Warehouse Coordinator", ar: "منسق مستودع", dept: "warehouse", band: [5000, 7000] },
    { en: "Inventory Analyst", ar: "محلل مخزون", dept: "operations", band: [6500, 9000] },
    { en: "Customer Service Rep", ar: "ممثل خدمة عملاء", dept: "operations", band: [4500, 6500] },
    { en: "Marketing Executive", ar: "تنفيذي تسويق", dept: "operations", band: [7000, 10000] },
  ],
  technology: [
    { en: "Software Engineer", ar: "مهندس برمجيات", dept: "engineering", band: [11000, 16000] },
    { en: "Frontend Developer", ar: "مطور واجهات", dept: "engineering", band: [10000, 14500] },
    { en: "Backend Developer", ar: "مطور خلفيات", dept: "engineering", band: [11000, 16000] },
    { en: "QA Engineer", ar: "مهندس ضمان جودة", dept: "qa", band: [9000, 13000] },
    { en: "Product Designer", ar: "مصمم منتجات", dept: "design", band: [10000, 15000] },
    { en: "Product Manager", ar: "مدير منتج", dept: "product", band: [13000, 18000] },
    { en: "DevOps Engineer", ar: "مهندس DevOps", dept: "devops", band: [12000, 17000] },
    { en: "Data Engineer", ar: "مهندس بيانات", dept: "engineering", band: [12000, 16000] },
  ],
};

const BANK_POOL = ["Al Rajhi Bank", "Saudi National Bank", "Riyad Bank", "Banque Saudi Fransi", "Bank Albilad", "Arab National Bank"];

function deterministicIban(seed: number): string {
  const code = (seed * 9973).toString().padStart(20, "0").slice(0, 20);
  return `SA${(seed % 90 + 10).toString()}${code}`;
}

function makeIqama(seed: number): string {
  return `2${(seed * 7 + 100000000).toString().slice(0, 9)}`;
}

function makeNationalId(seed: number): string {
  return `1${(seed * 13 + 100000000).toString().slice(0, 9)}`;
}

function generateGenericEmployees(client: BaselineClient, namedForClient: BaselineEmployee[]): BaselineEmployee[] {
  const namedSaudi = namedForClient.filter((e) => e.isSaudi).length;
  const namedExpat = namedForClient.length - namedSaudi;
  const remainingSaudi = client.saudiCount - namedSaudi;
  const remainingExpat = client.expatCount - namedExpat;
  const roles = ROLES[client.industry] ?? ROLES.technology!;
  const out: BaselineEmployee[] = [];
  const idxOffset = namedForClient.length;

  function buildEmployee(idx: number, isSaudi: boolean): BaselineEmployee {
    const seed = idx * 31 + (client.id.length * 7);
    const role = roles[idx % roles.length]!;
    const salaryBand = role.band;
    const basic = Math.round(salaryBand[0]! + (salaryBand[1]! - salaryBand[0]!) * rng());
    const housing = Math.round(basic * 0.25);
    const transport = intBetween(400, 800);
    const yos = +(rng() * 6 + 0.6).toFixed(1);
    const hireDate = new Date(2025 - Math.floor(yos), Math.floor(rng() * 12), 1 + Math.floor(rng() * 27))
      .toISOString()
      .slice(0, 10);
    let firstEn = "";
    let firstAr = "";
    let lastEn = "";
    let lastAr = "";
    let nationality = "saudi";
    if (isSaudi) {
      const isFemale = rng() > 0.7;
      if (isFemale) {
        firstEn = SAUDI_FIRST_F[seed % SAUDI_FIRST_F.length]!;
        firstAr = ARABIC_FIRST_F[firstEn] ?? firstEn;
      } else {
        firstEn = SAUDI_FIRST_M[seed % SAUDI_FIRST_M.length]!;
        firstAr = ARABIC_FIRST_M[firstEn] ?? firstEn;
      }
      lastEn = SAUDI_LAST[(seed >> 2) % SAUDI_LAST.length]!;
      lastAr = SAUDI_LAST_AR[lastEn] ?? lastEn;
    } else {
      const profile = EXPAT_PROFILES[seed % EXPAT_PROFILES.length]!;
      firstEn = profile.first[(seed >> 1) % profile.first.length]!;
      lastEn = profile.last[(seed >> 3) % profile.last.length]!;
      firstAr = firstEn;
      lastAr = lastEn;
      nationality = profile.nat;
    }
    const fullNameEn = `${firstEn} ${lastEn}`;
    const fullNameAr = `${firstAr} ${lastAr}`;
    const empSerial = (idxOffset + idx + 1).toString().padStart(3, "0");
    const id = `emp-${client.id.replace("client-", "")}-${empSerial}`;
    return {
      id,
      clientId: client.id,
      fullNameEn,
      fullNameAr,
      nationality,
      isSaudi,
      role: role.en,
      roleAr: role.ar,
      department: role.dept,
      hireDate,
      yearsOfService: yos,
      status: "active",
      contractType: isSaudi ? "unlimited" : "limited",
      nationalId: isSaudi ? makeNationalId(seed) : null,
      iqamaNumber: isSaudi ? null : makeIqama(seed),
      iban: deterministicIban(seed + 1000),
      bankName: BANK_POOL[(seed >> 4) % BANK_POOL.length]!,
      email: `${firstEn.toLowerCase()}.${lastEn.toLowerCase().replace(/\s+/g, "")}@${client.id.replace("client-", "")}.sa`,
      phone: `+966-50${(seed % 10000000).toString().padStart(7, "0")}`,
      basicSalary: basic,
      housingAllowance: housing,
      transportAllowance: transport,
      otherAllowances: rng() > 0.7 ? [{ label: "Mobile", labelAr: "بدل جوال", amount: intBetween(150, 400) }] : [],
      storyTags: [],
      notes: null,
    };
  }
  let counter = 0;
  for (let i = 0; i < remainingSaudi; i += 1) out.push(buildEmployee(counter++, true));
  for (let i = 0; i < remainingExpat; i += 1) out.push(buildEmployee(counter++, false));
  return out;
}

// ─── Domain helpers ───────────────────────────────────────────────────────

function computeGosi(basicPlusHousing: number, isSaudi: boolean) {
  const employerAnnuity = isSaudi ? Math.round(basicPlusHousing * 0.12) : 0;
  const employeeAnnuity = isSaudi ? Math.round(basicPlusHousing * 0.10) : 0;
  const ohrpEmployer = Math.round(basicPlusHousing * 0.02);
  return {
    employerAnnuity,
    employeeAnnuity,
    ohrpEmployer,
    totalEmployer: employerAnnuity + ohrpEmployer,
    totalEmployee: employeeAnnuity,
  };
}

function computeEosbAccrual(yos: number, basicPlusHousing: number): number {
  if (yos < 5) return Math.round(basicPlusHousing * 0.5 / 12);
  return Math.round(basicPlusHousing / 12);
}

function computeFullEosb(yos: number, basicPlusHousing: number): number {
  const firstYears = Math.min(5, yos);
  const remainingYears = Math.max(0, yos - 5);
  return Math.round(firstYears * 0.5 * basicPlusHousing + remainingYears * 1.0 * basicPlusHousing);
}

// ─── Agent performance trajectories ──────────────────────────────────────

const AGENT_PROFILE: Record<string, { acc: [number, number]; speed: [number, number]; auto: [number, number]; quality: [number, number]; tasks: [number, number]; latency: [number, number] }> = {
  "payroll-orchestrator":  { acc: [0.97, 0.99], speed: [0.92, 0.97], auto: [0.85, 0.92], quality: [0.96, 0.99], tasks: [180, 230], latency: [0.6, 1.4] },
  "document-intelligence": { acc: [0.92, 0.97], speed: [0.85, 0.93], auto: [0.55, 0.75], quality: [0.94, 0.98], tasks: [40, 70], latency: [2.8, 6.0] },
  "salary-calculation":    { acc: [0.97, 0.995], speed: [0.95, 0.99], auto: [0.92, 0.97], quality: [0.97, 0.99], tasks: [120, 180], latency: [0.4, 1.0] },
  "gosi-compliance":       { acc: [0.99, 0.999], speed: [0.93, 0.97], auto: [0.95, 0.99], quality: [0.98, 0.999], tasks: [3, 6], latency: [3.0, 6.5] },
  "mudad-bank-transfer":   { acc: [0.96, 0.98], speed: [0.90, 0.95], auto: [0.88, 0.93], quality: [0.95, 0.98], tasks: [3, 6], latency: [4.5, 9.0] },
  "eosb-provision":        { acc: [0.98, 0.995], speed: [0.94, 0.98], auto: [0.85, 0.92], quality: [0.97, 0.99], tasks: [40, 60], latency: [0.8, 1.6] },
  "leave-management":      { acc: [0.95, 0.98], speed: [0.91, 0.96], auto: [0.80, 0.90], quality: [0.94, 0.98], tasks: [70, 110], latency: [0.6, 1.4] },
  "saudization-monitor":   { acc: [0.94, 0.97], speed: [0.88, 0.94], auto: [0.78, 0.88], quality: [0.93, 0.97], tasks: [9, 14], latency: [2.0, 4.5] },
  "performance-audit":     { acc: [0.93, 0.96], speed: [0.86, 0.92], auto: [0.70, 0.85], quality: [0.92, 0.96], tasks: [30, 50], latency: [3.5, 7.0] },
  "client-communications": { acc: [0.91, 0.95], speed: [0.87, 0.94], auto: [0.65, 0.82], quality: [0.90, 0.96], tasks: [50, 90], latency: [1.5, 3.5] },
};

function withinBand(band: [number, number], progress: number): number {
  // progress 0..1 — we ramp up from low to high through the period
  const lo = band[0];
  const hi = band[1];
  return +(lo + (hi - lo) * progress).toFixed(3);
}

// ─── Seed entry ──────────────────────────────────────────────────────────

// Narrative anchor: today is 2026-05-05. April is fully settled and paid.
// May 2026 is the in-flight cycle currently being prepared by the agents.
const PERIODS: { year: number; month: number }[] = [
  { year: 2025, month: 12 },
  { year: 2026, month: 1 },
  { year: 2026, month: 2 },
  { year: 2026, month: 3 },
  { year: 2026, month: 4 },
  { year: 2026, month: 5 },
];

const CURRENT_PERIOD = PERIODS[PERIODS.length - 1]!; // May 2026 — in-preparation
const APRIL_PERIOD = { year: 2026, month: 4 } as const; // most recent settled

async function seed() {
  console.log("[seed-tasama] reading baseline …");
  const baseline: Baseline = JSON.parse(await fs.readFile(BASELINE_PATH, "utf8"));

  console.log("[seed-tasama] truncating tasama tables …");
  await db.execute(`TRUNCATE TABLE
    tasama_clients, tasama_employees, tasama_salary_components,
    tasama_payroll_runs, tasama_payslips, tasama_documents,
    tasama_service_requests, tasama_gosi_records, tasama_leave_balances,
    tasama_eosb_provisions, tasama_regulatory_calendar,
    tasama_agent_performance RESTART IDENTITY` as never);

  // Clients ----------------------------------------------------------------
  console.log(`[seed-tasama] inserting ${baseline.clients.length} clients`);
  for (const c of baseline.clients) {
    await db.insert(tasamaClientsTable).values({
      id: c.id,
      legalNameEn: c.legalNameEn,
      legalNameAr: c.legalNameAr,
      industry: c.industry,
      employeeCount: c.employeeCount,
      saudiCount: c.saudiCount,
      expatCount: c.expatCount,
      saudizationBand: c.saudizationBand,
      saudizationPercent: c.saudizationPercent,
      monthlyPayrollGross: c.monthlyPayrollGross,
      contactName: c.contactName,
      contactEmail: c.contactEmail,
      activeEvents: c.activeEvents,
      onboardedAt: c.onboardedAt,
      payrollCutoffDay: c.payrollCutoffDay ?? 25,
    });
  }

  // Employees: named + generated --------------------------------------------
  const allEmployees: BaselineEmployee[] = [...baseline.namedEmployees];
  for (const client of baseline.clients) {
    const namedForClient = baseline.namedEmployees.filter((e) => e.clientId === client.id);
    const generic = generateGenericEmployees(client, namedForClient);
    allEmployees.push(...generic);
  }
  console.log(`[seed-tasama] inserting ${allEmployees.length} employees (${baseline.namedEmployees.length} named + ${allEmployees.length - baseline.namedEmployees.length} generated)`);

  // Per-client headcount sanity check — Tasama UI breaks if any client has 0.
  for (const client of baseline.clients) {
    const count = allEmployees.filter((e) => e.clientId === client.id).length;
    console.log(`[seed-tasama]   ${client.id}: ${count} employees (baseline says ${client.employeeCount})`);
    if (count === 0) {
      throw new Error(`[seed-tasama] FATAL: client ${client.id} produced 0 employees — fix generateGenericEmployees() before seeding`);
    }
    if (count !== client.employeeCount) {
      console.warn(`[seed-tasama]   ⚠ ${client.id} has ${count} employees but baseline.employeeCount=${client.employeeCount}`);
    }
  }
  for (const e of allEmployees) {
    await db.insert(tasamaEmployeesTable).values({
      id: e.id,
      clientId: e.clientId,
      fullNameEn: e.fullNameEn,
      fullNameAr: e.fullNameAr,
      nationality: e.nationality,
      isSaudi: e.isSaudi,
      role: e.role,
      roleAr: e.roleAr,
      department: e.department,
      hireDate: e.hireDate,
      yearsOfService: e.yearsOfService,
      status: e.status,
      contractType: e.contractType,
      iqamaNumber: e.iqamaNumber,
      nationalId: e.nationalId,
      iban: e.iban,
      bankName: e.bankName,
      email: e.email,
      phone: e.phone,
      storyTags: e.storyTags,
      notes: e.notes,
    });
  }

  // Salary components, leave balances, current EOSB ------------------------
  console.log(`[seed-tasama] inserting salary, leave, EOSB rows`);
  for (const e of allEmployees) {
    const otherTotal = e.otherAllowances.reduce((s, a) => s + a.amount, 0);
    const gross = e.basicSalary + e.housingAllowance + e.transportAllowance + otherTotal;
    await db.insert(tasamaSalaryComponentsTable).values({
      id: `sal-${e.id}`,
      employeeId: e.id,
      basicSalary: e.basicSalary,
      housingAllowance: e.housingAllowance,
      transportAllowance: e.transportAllowance,
      otherAllowances: e.otherAllowances,
      grossMonthly: gross,
      effectiveFrom: e.hireDate,
      effectiveTo: null,
    });

    const annualEntitlement = e.yearsOfService >= 5 ? 30 : 21;
    const annualUsed = Math.min(annualEntitlement, intBetween(0, Math.round(annualEntitlement * 0.6)));
    await db.insert(tasamaLeaveBalancesTable).values({
      id: `leave-${e.id}`,
      employeeId: e.id,
      annualEntitlement,
      annualUsed,
      annualRemaining: annualEntitlement - annualUsed,
      sickUsedDays: intBetween(0, 5),
      otherLeaveUsed: e.storyTags.includes("maternity-leave") ? { maternity: 70 } : {},
      pendingRequests: e.storyTags.includes("maternity-leave")
        ? [{ type: "maternity", days: 70, startDate: "2025-09-15" }]
        : [],
      asOfDate: baseline.asOfDate,
    });

    const basicHousing = e.basicSalary + e.housingAllowance;
    const monthlyAccrual = computeEosbAccrual(e.yearsOfService, basicHousing);
    const cumulative = Math.round(monthlyAccrual * 12 * e.yearsOfService);
    const fullPayout = computeFullEosb(e.yearsOfService, basicHousing);
    await db.insert(tasamaEosbProvisionsTable).values({
      id: `eosb-${e.id}-${CURRENT_PERIOD.year}${String(CURRENT_PERIOD.month).padStart(2, "0")}`,
      employeeId: e.id,
      clientId: e.clientId,
      periodYear: CURRENT_PERIOD.year,
      periodMonth: CURRENT_PERIOD.month,
      yearsOfService: e.yearsOfService,
      lastBasicPlusHousing: basicHousing,
      accruedThisMonth: monthlyAccrual,
      cumulativeProvision: cumulative,
      estimatedFullPayout: fullPayout,
    });
  }

  // Payroll runs + payslips + GOSI records (Apr-Sep 2025) ------------------
  let payslipCount = 0;
  let gosiCount = 0;
  let runCount = 0;
  console.log(`[seed-tasama] computing 6 monthly payroll runs per client`);
  for (const client of baseline.clients) {
    const clientEmployees = allEmployees.filter((e) => e.clientId === client.id);
    for (const period of PERIODS) {
      const runId = `run-${client.id}-${period.year}-${String(period.month).padStart(2, "0")}`;
      let totalGross = 0;
      let totalNet = 0;
      let totalEmployer = 0;
      let totalEmployee = 0;
      const payslipRows: Array<typeof tasamaPayslipsTable.$inferInsert> = [];
      const gosiRows: Array<typeof tasamaGosiRecordsTable.$inferInsert> = [];

      const isCurrent = period.year === CURRENT_PERIOD.year && period.month === CURRENT_PERIOD.month;
      const isApril = period.year === APRIL_PERIOD.year && period.month === APRIL_PERIOD.month;
      // Mohammad Al-Ghamdi's last working day is 2026-04-30 — exclude from May.
      const employeesForPeriod = clientEmployees.filter((e) => {
        if (e.id === "emp-alnakhla-003" && isCurrent) return false; // skip in May 2026
        return true;
      });
      for (const e of employeesForPeriod) {
        const otherTotal = e.otherAllowances.reduce((s, a) => s + a.amount, 0);
        const overtime = e.department === "construction" || e.department === "operations"
          ? intBetween(0, 600)
          : 0;
        // April 2026: Sarah Johnson Q1 performance bonus = SAR 15,000 (already paid)
        const bonus = (isApril && e.storyTags.includes("performance-bonus")) ? 15000
          : (period.month === 6 && rng() > 0.85) ? intBetween(1000, 3000)
          : 0;
        // April 2026: Ahmed Al-Rashidi 2-month retroactive promotion adjustment = SAR 4,600
        const retro = (isApril && e.storyTags.includes("retroactive-adjustment")) ? 4600 : 0;
        const grossPay = e.basicSalary + e.housingAllowance + e.transportAllowance + otherTotal + overtime + bonus + retro;
        const basicHousing = e.basicSalary + e.housingAllowance;
        const gosi = computeGosi(basicHousing, e.isSaudi);
        const otherDeductions = 0;
        const netPay = grossPay - gosi.totalEmployee - otherDeductions;
        totalGross += grossPay;
        totalNet += netPay;
        totalEmployer += gosi.totalEmployer;
        totalEmployee += gosi.totalEmployee;

        payslipRows.push({
          id: `slip-${e.id}-${period.year}-${String(period.month).padStart(2, "0")}`,
          runId,
          employeeId: e.id,
          clientId: client.id,
          periodYear: period.year,
          periodMonth: period.month,
          basicSalary: e.basicSalary,
          housingAllowance: e.housingAllowance,
          transportAllowance: e.transportAllowance,
          otherAllowances: otherTotal,
          overtime,
          bonus,
          retroAdjustment: retro,
          grossPay,
          gosiEmployeeDeduction: gosi.totalEmployee,
          otherDeductions,
          netPay,
          paymentStatus: isCurrent ? "pending" : "paid",
          paymentDate: isCurrent ? null : `${period.year}-${String(period.month).padStart(2, "0")}-27`,
          mudadRef: isCurrent ? null : `MUD-${client.id.replace("client-", "").toUpperCase()}-${period.year}${String(period.month).padStart(2, "0")}-${e.id.split("-").pop()}`,
        });

        gosiRows.push({
          id: `gosi-${e.id}-${period.year}-${String(period.month).padStart(2, "0")}`,
          employeeId: e.id,
          clientId: client.id,
          periodYear: period.year,
          periodMonth: period.month,
          isSaudi: e.isSaudi,
          basicPlusHousing: basicHousing,
          employerAnnuity: gosi.employerAnnuity,
          employeeAnnuity: gosi.employeeAnnuity,
          ohrpEmployer: gosi.ohrpEmployer,
          totalEmployer: gosi.totalEmployer,
          totalEmployee: gosi.totalEmployee,
          filingStatus: isCurrent ? "draft" : "accepted",
          filedAt: isCurrent
            ? null
            : `${period.month === 12 ? period.year + 1 : period.year}-${String(((period.month) % 12) + 1).padStart(2, "0")}-10`,
          filingReference: `GOSI-${client.id.replace("client-", "").toUpperCase()}-${period.year}${String(period.month).padStart(2, "0")}`,
        });
      }

      // Current-period (May 2026) semantics: cycle is mid-prep (today = 5 May).
      // Cutoffs occur on day 22 (Luma), 25 (Al-Nakhla), or 28 (Vertex).
      // Status: "in-preparation" — no run/settled date, no Mudad batch yet.
      // April fully settled & paid by all clients on day 27.
      const cutoffDay = client.payrollCutoffDay ?? 25;
      const status = isCurrent ? "in-preparation" : "settled";
      const approvedBy = isCurrent ? null : client.contactName;
      await db.insert(tasamaPayrollRunsTable).values({
        id: runId,
        clientId: client.id,
        periodYear: period.year,
        periodMonth: period.month,
        runDate: `${period.year}-${String(period.month).padStart(2, "0")}-${String(cutoffDay).padStart(2, "0")}`,
        status,
        totalGross,
        totalNet,
        totalGosiEmployer: totalEmployer,
        totalGosiEmployee: totalEmployee,
        employeeCount: payslipRows.length,
        approvedBy,
        approvedAt: isCurrent ? null : `${period.year}-${String(period.month).padStart(2, "0")}-${String(cutoffDay).padStart(2, "0")}`,
        settledAt: isCurrent ? null : `${period.year}-${String(period.month).padStart(2, "0")}-27`,
        mudadBatchRef: isCurrent ? null : `MUD-${client.id.replace("client-", "").toUpperCase()}-${period.year}${String(period.month).padStart(2, "0")}`,
        notes: isCurrent
          ? `May 2026 cycle in preparation — cutoff day ${cutoffDay}, settles ~${cutoffDay + 2} May 2026`
          : null,
      });
      runCount += 1;

      if (payslipRows.length) {
        await db.insert(tasamaPayslipsTable).values(payslipRows);
        payslipCount += payslipRows.length;
      }
      if (gosiRows.length) {
        await db.insert(tasamaGosiRecordsTable).values(gosiRows);
        gosiCount += gosiRows.length;
      }
    }
  }
  console.log(`[seed-tasama] inserted ${runCount} payroll runs, ${payslipCount} payslips, ${gosiCount} GOSI records`);

  // Documents (with PDF byte size from disk if available) ------------------
  console.log(`[seed-tasama] inserting ${baseline.documents.length} documents`);
  let pdfMissing = 0;
  for (const doc of baseline.documents) {
    let sizeBytes = 0;
    try {
      const stat = await fs.stat(path.join(PDF_DIR, doc.filename));
      sizeBytes = stat.size;
    } catch {
      pdfMissing += 1;
    }
    await db.insert(tasamaDocumentsTable).values({
      id: doc.id,
      clientId: doc.clientId,
      employeeId: doc.employeeId,
      type: doc.type,
      titleEn: doc.titleEn,
      titleAr: doc.titleAr,
      referenceNumber: doc.referenceNumber,
      issuedAt: doc.issuedAt,
      signedByName: doc.signedByName,
      signedByTitle: doc.signedByTitle,
      language: "bilingual",
      filename: doc.filename,
      mimeType: "application/pdf",
      sizeBytes,
      extractedFields: doc.extractedFields,
      overallConfidence: doc.overallConfidence,
      storagePath: doc.filename,
      processedAt: doc.issuedAt,
    });
  }
  if (pdfMissing > 0) {
    console.warn(`[seed-tasama] WARNING: ${pdfMissing} PDF files missing — run "pnpm --filter @workspace/scripts run generate:tasama-pdfs" first.`);
  }

  // Service requests --------------------------------------------------------
  console.log(`[seed-tasama] inserting ${baseline.serviceRequests.length} service requests`);
  for (const r of baseline.serviceRequests) {
    await db.insert(tasamaServiceRequestsTable).values({
      id: r.id,
      clientId: r.clientId,
      employeeId: r.employeeId,
      type: r.type,
      titleEn: r.titleEn,
      titleAr: r.titleAr,
      description: r.description,
      descriptionAr: r.descriptionAr,
      status: r.status,
      priority: r.priority,
      requestedBy: r.requestedBy,
      requestedAt: r.requestedAt,
      assignedAgent: r.assignedAgent,
      completedAt: r.completedAt,
      payload: r.payload,
      slaTargetHours: r.slaTargetHours,
    });
  }

  // Regulatory calendar -----------------------------------------------------
  console.log(`[seed-tasama] inserting ${baseline.regulatoryCalendar.length} calendar events`);
  for (const c of baseline.regulatoryCalendar) {
    await db.insert(tasamaRegulatoryCalendarTable).values({
      id: c.id,
      eventType: c.eventType,
      nameEn: c.nameEn,
      nameAr: c.nameAr,
      clientId: c.clientId,
      employeeId: c.employeeId,
      dueDate: c.dueDate,
      type: c.type,
      descriptionEn: c.descriptionEn,
      descriptionAr: c.descriptionAr,
      referenceNumber: c.referenceNumber,
      completedAt: c.completedAt,
    });
  }

  // Agent performance — 10 agents x 6 months -------------------------------
  let perfCount = 0;
  console.log(`[seed-tasama] computing 60 agent performance rows`);
  const agentIds = Object.keys(AGENT_PROFILE);
  for (const agentId of agentIds) {
    const profile = AGENT_PROFILE[agentId]!;
    for (let i = 0; i < PERIODS.length; i += 1) {
      const period = PERIODS[i]!;
      const progress = (i + 1) / PERIODS.length;
      const accuracy = withinBand(profile.acc, progress);
      const speed = withinBand(profile.speed, progress);
      const autonomy = withinBand(profile.auto, progress);
      const quality = withinBand(profile.quality, progress);
      // Spec composite weights: accuracy 35%, speed 25%, autonomy 20%, quality 20%.
      const composite = +((accuracy * 0.35 + speed * 0.25 + autonomy * 0.20 + quality * 0.20)).toFixed(3);
      const tasksProcessed = intBetween(profile.tasks[0], profile.tasks[1]);
      const humanOverrides = Math.max(0, Math.round(tasksProcessed * (1 - autonomy) * 0.4));
      const escalations = Math.max(0, Math.round(tasksProcessed * (1 - accuracy) * 0.5));
      const errorCount = Math.max(0, Math.round(tasksProcessed * (1 - accuracy)));
      const avgLatencySeconds = +(profile.latency[0] + (profile.latency[1] - profile.latency[0]) * (1 - progress * 0.4)).toFixed(2);
      const notable: string[] = [];
      if (i === PERIODS.length - 1 && agentId === "client-communications") notable.push("Drift detected: April sentiment slightly off-tone on bilingual replies — calibration scheduled");
      if (i === PERIODS.length - 1 && agentId === "saudization-monitor") notable.push("Vertex Tech in Yellow band — Q2 action plan in progress");
      if (i === PERIODS.length - 1 && agentId === "gosi-compliance") notable.push("100% on-time filing streak — 18 consecutive months through March 2026");
      if (i === PERIODS.length - 1 && agentId === "salary-calculation") notable.push("Processed Ahmed Al-Rashidi 2-month retroactive (SAR 4,600) and Sarah Johnson Q1 bonus (SAR 15,000)");
      if (i === PERIODS.length - 1 && agentId === "eosb-provision") notable.push("Calculated Mohammad Al-Ghamdi final settlement: SAR 196,450");

      await db.insert(tasamaAgentPerformanceTable).values({
        id: `perf-${agentId}-${period.year}-${String(period.month).padStart(2, "0")}`,
        agentId,
        periodYear: period.year,
        periodMonth: period.month,
        accuracy,
        speed,
        autonomy,
        quality,
        composite,
        tasksProcessed,
        humanOverrides,
        escalations,
        avgLatencySeconds,
        errorCount,
        notableEvents: notable,
      });
      perfCount += 1;
    }
  }

  // Summary
  const totalRecords =
    baseline.clients.length +
    allEmployees.length * 4 + // employees + salary + leave + eosb
    runCount + payslipCount + gosiCount +
    baseline.documents.length +
    baseline.serviceRequests.length +
    baseline.regulatoryCalendar.length +
    perfCount;
  console.log(`[seed-tasama] DONE. ~${totalRecords} records inserted.`);
  console.log(`[seed-tasama]   - clients: ${baseline.clients.length}`);
  console.log(`[seed-tasama]   - employees: ${allEmployees.length} (${baseline.namedEmployees.length} named, ${allEmployees.length - baseline.namedEmployees.length} generated)`);
  console.log(`[seed-tasama]   - salary components: ${allEmployees.length}`);
  console.log(`[seed-tasama]   - leave balances: ${allEmployees.length}`);
  console.log(`[seed-tasama]   - EOSB provisions: ${allEmployees.length}`);
  console.log(`[seed-tasama]   - payroll runs: ${runCount}`);
  console.log(`[seed-tasama]   - payslips: ${payslipCount}`);
  console.log(`[seed-tasama]   - GOSI records: ${gosiCount}`);
  console.log(`[seed-tasama]   - documents: ${baseline.documents.length}`);
  console.log(`[seed-tasama]   - service requests: ${baseline.serviceRequests.length}`);
  console.log(`[seed-tasama]   - regulatory calendar: ${baseline.regulatoryCalendar.length}`);
  console.log(`[seed-tasama]   - agent performance: ${perfCount}`);
}

seed()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
