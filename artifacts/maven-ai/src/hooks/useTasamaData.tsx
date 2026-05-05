import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  TasamaClient,
  TasamaEmployee,
  SalaryComponent,
  PayrollRun,
  Payslip,
  TasamaDocument,
  ServiceRequest,
  GosiRecord,
  LeaveBalance,
  EosbProvision,
  RegulatoryCalendarEntry,
  AgentPerformanceRecord,
} from "@/data/tasama-seed";
import {
  AgentOpsSkeleton,
  ClientPortalSkeleton,
  ManagerDashboardSkeleton,
  DataErrorState,
} from "@/components/demo/tasama/DataLoadingStates";

export interface TasamaData {
  clients: TasamaClient[];
  employees: TasamaEmployee[];
  salaryComponents: SalaryComponent[];
  payrollRuns: PayrollRun[];
  payslips: Payslip[];
  documents: TasamaDocument[];
  serviceRequests: ServiceRequest[];
  gosiRecords: GosiRecord[];
  leaveBalances: LeaveBalance[];
  eosbProvisions: EosbProvision[];
  regulatoryCalendar: RegulatoryCalendarEntry[];
  agentPerformance: AgentPerformanceRecord[];
}

const EMPTY: TasamaData = {
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

let _snapshot: TasamaData = EMPTY;
let _ready = false;

export function getTasamaDataSnapshot(): TasamaData {
  return _snapshot;
}

export function isTasamaDataReady(): boolean {
  return _ready;
}

const BASE = "/api/tasama";

async function fetchEnvelope<K extends string, T>(url: string, key: K): Promise<T[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
  const json = (await res.json()) as Record<K, T[]>;
  return (json[key] ?? []) as T[];
}

async function fetchAllTasamaData(): Promise<TasamaData> {
  const [
    clients,
    employees,
    salaryComponents,
    payrollRuns,
    payslips,
    documents,
    serviceRequests,
    gosiRecords,
    leaveBalances,
    eosbProvisions,
    regulatoryCalendar,
    agentPerformance,
  ] = await Promise.all([
    fetchEnvelope<"clients", TasamaClient>(`${BASE}/clients`, "clients"),
    fetchEnvelope<"employees", TasamaEmployee>(`${BASE}/employees`, "employees"),
    fetchEnvelope<"salaryComponents", SalaryComponent>(`${BASE}/salary-components`, "salaryComponents"),
    fetchEnvelope<"payrollRuns", PayrollRun>(`${BASE}/payroll-runs`, "payrollRuns"),
    fetchEnvelope<"payslips", Payslip>(`${BASE}/payslips`, "payslips"),
    fetchEnvelope<"documents", TasamaDocument>(`${BASE}/documents`, "documents"),
    fetchEnvelope<"serviceRequests", ServiceRequest>(`${BASE}/service-requests`, "serviceRequests"),
    fetchEnvelope<"gosiRecords", GosiRecord>(`${BASE}/gosi-records`, "gosiRecords"),
    fetchEnvelope<"leaveBalances", LeaveBalance>(`${BASE}/leave-balances`, "leaveBalances"),
    fetchEnvelope<"eosbProvisions", EosbProvision>(`${BASE}/eosb-provisions`, "eosbProvisions"),
    fetchEnvelope<"regulatoryCalendar", RegulatoryCalendarEntry>(`${BASE}/regulatory-calendar`, "regulatoryCalendar"),
    fetchEnvelope<"agentPerformance", AgentPerformanceRecord>(`${BASE}/agent-performance`, "agentPerformance"),
  ]);
  const data: TasamaData = {
    clients,
    employees,
    salaryComponents,
    payrollRuns,
    payslips,
    documents,
    serviceRequests,
    gosiRecords,
    leaveBalances,
    eosbProvisions,
    regulatoryCalendar,
    agentPerformance,
  };
  _snapshot = data;
  _ready = true;
  return data;
}

const TasamaDataCtx = createContext<TasamaData>(EMPTY);

export function useTasamaData(): TasamaData {
  return useContext(TasamaDataCtx);
}

// Spec calls out two operator-facing variants ("client" + "manager"). The
// Tasama foundation also exposes a third "teknik" (agent-ops) variant used
// by the AgentOpsShell skeleton so internal Tasama operators can debug
// agent runs alongside the client and manager surfaces. The two spec
// variants ("client", "manager") are required; "teknik" is an
// intentional Tasama-side extension.
export type TasamaVariant = "teknik" | "client" | "manager";

export function TasamaDataProvider({
  children,
  fallback,
  variant = "manager",
}: {
  children: ReactNode;
  fallback?: ReactNode;
  variant?: TasamaVariant;
}) {
  const { data, isLoading, isError, refetch } = useQuery<TasamaData>({
    queryKey: ["tasama", "all-data"],
    queryFn: fetchAllTasamaData,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  if (isLoading && !data) {
    if (fallback) return <>{fallback}</>;
    if (variant === "teknik") return <AgentOpsSkeleton />;
    if (variant === "client") return <ClientPortalSkeleton />;
    return <ManagerDashboardSkeleton />;
  }

  if (isError && !data) {
    if (fallback) return <>{fallback}</>;
    return <DataErrorState onRetry={() => refetch()} />;
  }

  return <TasamaDataCtx.Provider value={data ?? EMPTY}>{children}</TasamaDataCtx.Provider>;
}
