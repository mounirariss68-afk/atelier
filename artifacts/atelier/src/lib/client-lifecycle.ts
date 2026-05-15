/**
 * Client lens sections — flat IA used by the Clients lens.
 *
 * Single source of truth for section ids, labels and hrefs. Imported by:
 *   - the lens section-tabs slot in the shell (`lens.ts`)
 *   - the per-section wrapper pages (`ClientsStages.tsx`)
 *   - the Overview pipeline dashboard's quick-link footer
 *
 * The previous seven-stage lifecycle (Prospect → … → Reference) was
 * collapsed per user feedback: renewals/expansions are just opportunities
 * carrying a deal-type flag, so a dedicated Renew tab/route is gone, and
 * the Win intake folds back into Opportunities.
 */

export type ClientSectionId =
  | "overview"
  | "accounts"
  | "opportunities"
  | "engagements"
  | "billing"
  | "references";

export interface ClientSectionDef {
  id: ClientSectionId;
  label: string;
  href: string;
}

export const CLIENT_SECTIONS: readonly ClientSectionDef[] = [
  { id: "overview", label: "Overview", href: "/clients" },
  { id: "accounts", label: "Accounts", href: "/clients/accounts" },
  { id: "opportunities", label: "Opportunities", href: "/clients/opportunities" },
  { id: "engagements", label: "Engagements", href: "/clients/engagements" },
  { id: "billing", label: "Billing", href: "/clients/billing" },
  { id: "references", label: "References", href: "/clients/references" },
] as const;
