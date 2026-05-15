/**
 * Client lifecycle stages — the seven-stage commercial loop the Clients
 * lens organises around (Task #369).
 *
 * Single source of truth for stage ids, labels, hrefs and short blurbs.
 * Imported by:
 *   - the lifecycle ribbon home (`/clients`)
 *   - the per-stage wrapper pages
 *   - the lens section-tabs slot in the shell
 */

export type ClientStageId =
  | "prospect"
  | "pursue"
  | "win"
  | "deliver"
  | "bill"
  | "renew"
  | "reference";

export interface ClientStageDef {
  id: ClientStageId;
  label: string;
  href: string;
  blurb: string;
}

export const CLIENT_LIFECYCLE_STAGES: readonly ClientStageDef[] = [
  { id: "prospect", label: "Prospect", href: "/clients/prospect", blurb: "Target list & account intelligence." },
  { id: "pursue", label: "Pursue", href: "/clients/pursue", blurb: "Opportunities pipeline & qualifiers." },
  { id: "win", label: "Win", href: "/clients/win", blurb: "Stage transitions, proposals, win/loss intake." },
  { id: "deliver", label: "Deliver", href: "/clients/deliver", blurb: "Engagements, deliverables, change orders." },
  { id: "bill", label: "Bill", href: "/clients/bill", blurb: "Engagement economics; billing in Finance." },
  { id: "renew", label: "Renew", href: "/clients/renew", blurb: "Renewals pipeline & expansion plays." },
  { id: "reference", label: "Reference", href: "/clients/reference", blurb: "Win/Loss themes & reference accounts." },
] as const;
