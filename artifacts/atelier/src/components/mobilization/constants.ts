/**
 * Shared constants for mobilization UI (option lists, token maps, helpers).
 */

export const API = "/api/atelier";

export const MOB_ENG_QK = (engId: string) => ["engagement-mobilization", engId];
export const MOB_ME_QK = () => ["me-mobilization-assignments"];

export const STATE_TONE: Record<string, "default" | "gold" | "green" | "amber" | "red"> = {
  proposed: "gold",
  accepted: "green",
  declined: "red",
  replaced: "amber",
  ended: "default",
};

export const AVAIL_TONE: Record<string, "default" | "green" | "amber" | "red"> = {
  available: "green",
  tentative: "amber",
  unavailable: "red",
  unknown: "default",
};

export const SENIORITIES = [
  { value: "analyst", label: "Analyst" },
  { value: "associate", label: "Associate" },
  { value: "consultant", label: "Consultant" },
  { value: "senior_consultant", label: "Senior Consultant" },
  { value: "manager", label: "Manager" },
  { value: "senior_manager", label: "Senior Manager" },
  { value: "associate_director", label: "Associate Director" },
  { value: "director", label: "Director" },
  { value: "partner", label: "Partner" },
  { value: "founding_partner", label: "Founding Partner" },
];

export const AVAIL_OPTIONS = [
  { value: "unknown", label: "Unknown" },
  { value: "available", label: "Available" },
  { value: "tentative", label: "Tentative" },
  { value: "unavailable", label: "Unavailable" },
];

export const CURRENCIES = ["USD", "AED", "SAR", "GBP", "EUR", "QAR", "KWD"];

export const HANDOFF_KINDS = [
  { value: "knowledge_transfer", label: "Knowledge transfer" },
  { value: "client_introduction", label: "Client introduction" },
  { value: "file_handover", label: "File handover" },
  { value: "system_access", label: "System access" },
  { value: "other", label: "Other" },
];

export const FIELD_CLS =
  "w-full bg-bg-elevate border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:ring-1 focus:ring-gold";

export function fmtDate(d: string): string {
  try {
    return new Date(d + "T00:00:00Z").toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return d;
  }
}

export function seniorityLabel(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
