/**
 * Task #1341 — the deliberately small People/Me launch surface.
 *
 * This is shared by the lens picker, in-page fallbacks and screen discovery.
 * Hidden lifecycle pages remain mounted for historical links and permissions;
 * they are not part of the launch navigation.
 */
export const PEOPLE_MVP_SECTIONS = [
  { id: "roster", label: "Roster", href: "/people/people" },
  { id: "time", label: "Time", href: "/people/time" },
  { id: "approvals", label: "Approvals", href: "/people/approvals" },
] as const;

export const ME_MVP_SECTIONS = [
  { id: "overview", label: "Overview", href: "/me" },
  { id: "profile", label: "Profile", href: "/me/profile" },
  { id: "time", label: "Time", href: "/me/time" },
  { id: "expenses", label: "Expenses", href: "/me/expenses" },
  { id: "pay", label: "Pay & Benefits", href: "/me/pay" },
] as const;

export const HIDDEN_PEOPLE_DESTINATION = "/people/people";
export const HIDDEN_ME_DESTINATION = "/me";

export function isPeopleMvpSection(id: string): boolean {
  return PEOPLE_MVP_SECTIONS.some((section) => section.id === id);
}

export function isMeMvpSection(id: string): boolean {
  return ME_MVP_SECTIONS.some((section) => section.id === id);
}