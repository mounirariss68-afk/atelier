/**
 * People lens — lifecycle stages (Task #364).
 *
 * Single source of truth for the eight lifecycle stages and the cross-cutting
 * modules. The People lens shell renders the lifecycle ribbon from this file
 * and the Manage shell's contextual section-tabs slot reads the same labels.
 *
 *   Attract → Hire → Onboard → Develop → Perform → Reward → Offboard
 */

export type StageId =
  | "attract"
  | "hire"
  | "onboard"
  | "develop"
  | "perform"
  | "reward"
  | "offboard";

export interface StageDef {
  id: StageId;
  label: string;
  /** /people/<href> */
  href: string;
  /** One-line owner summary used in the lifecycle ribbon tooltip. */
  blurb: string;
}

export const STAGES: readonly StageDef[] = [
  { id: "attract",  label: "Attract",  href: "/people/attract",  blurb: "Workforce plan and referrals." },
  { id: "hire",     label: "Hire",     href: "/people/hire",     blurb: "Roles, candidates, interviews, references, offers." },
  { id: "onboard",  label: "Onboard",  href: "/people/onboard",  blurb: "Pre-boarding, day-1, equipment, attestations." },
  { id: "develop",  label: "Develop",  href: "/people/develop",  blurb: "Training library and certifications." },
  { id: "perform",  label: "Perform",  href: "/people/perform",  blurb: "Goals, check-ins, reviews." },
  { id: "reward",   label: "Reward",   href: "/people/reward",   blurb: "Pay documents and bank changes." },
  { id: "offboard", label: "Offboard", href: "/people/offboard", blurb: "Offboarding queue and last-day tasks." },
] as const;

export interface CrossModuleDef {
  id: string;
  label: string;
  href: string;
}

export const CROSS_MODULES: readonly CrossModuleDef[] = [
  { id: "people",     label: "People directory", href: "/people/people" },
  { id: "access",     label: "Access matrix",    href: "/people/access" },
  { id: "skills",     label: "Skill graph",      href: "/people/skills" },
  { id: "composition", label: "Team composition", href: "/people/composition" },
  { id: "time",       label: "Time",             href: "/people/time" },
  { id: "compliance", label: "Compliance",       href: "/people/compliance" },
  { id: "approvals",  label: "Approvals",        href: "/people/approvals" },
] as const;

export function getStage(id: StageId): StageDef {
  const s = STAGES.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown stage ${id}`);
  return s;
}
