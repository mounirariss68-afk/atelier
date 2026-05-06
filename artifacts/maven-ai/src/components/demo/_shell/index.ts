/**
 * Shared shell primitives for the 10 user-facing demos.
 *
 * Every user demo shell (Knowledge Chat, Programme War Room, Value
 * Realization, Citizen Services, Customer Care, Network Ops,
 * Procurement Negotiation, SAMA Compliance, Sovereign Data,
 * Tender Response Studio) composes its layout from these primitives so a fix
 * to the sidebar / topbar / notifications / language toggle / collapsible-nav
 * pattern lands in every demo at once.
 *
 * The wrapper component is `UserDemoShell` — a slot-based frame that handles
 * the RTL document side effect and arranges the sidebar / header / topbar /
 * main / drawers / FAB regions. Each individual control (nav list, brand
 * block, lang toggle, collapse chevron, persona pill, notification bell) is
 * exported as its own building block.
 */
export { default as UserDemoShell } from "./UserDemoShell";
export type { UserDemoShellProps } from "./UserDemoShell";

export { default as DemoBrandBlock } from "./DemoBrandBlock";
export type { DemoBrandBlockProps } from "./DemoBrandBlock";

export { default as DemoSidebarNav } from "./DemoSidebarNav";
export type { DemoNavItem, DemoSidebarNavProps } from "./DemoSidebarNav";

export { default as DemoLangToggle } from "./DemoLangToggle";
export type { DemoLangToggleProps } from "./DemoLangToggle";

export { default as DemoCollapseToggle } from "./DemoCollapseToggle";
export type { DemoCollapseToggleProps } from "./DemoCollapseToggle";

export { default as DemoPersonaPill } from "./DemoPersonaPill";
export type { DemoPersonaPillProps } from "./DemoPersonaPill";

export { default as DemoNotifBell } from "./DemoNotifBell";
export type { DemoNotifBellProps } from "./DemoNotifBell";

export { useDemoRtl } from "./useDemoRtl";
