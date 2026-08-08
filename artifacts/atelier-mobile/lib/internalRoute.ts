/**
 * Task #785 / #794 — map internal web hrefs / navigateTo paths from chat
 * result cards to the expo-router route that shows the same content.
 *
 * The mobile app only has a subset of the web portal's screens (tabs:
 * chat, expenses, meetings, me, settings; plus /expense/new and
 * /expense/[id]). Paths whose content has no mobile surface (e.g.
 * /engagements/:id, /opportunities/:id, /documents, /wallet/invoices)
 * intentionally return null so the card stays non-pressable — never a
 * broken route.
 */
export function internalRouteFor(
  href: string,
): { route: string; label: string } | null {
  if (typeof href !== "string" || !href.startsWith("/")) return null;
  const [pathAndQuery] = href.split("#");
  const qIdx = pathAndQuery.indexOf("?");
  const path = qIdx === -1 ? pathAndQuery : pathAndQuery.slice(0, qIdx);
  const query = qIdx === -1 ? "" : pathAndQuery.slice(qIdx + 1);
  const seg = path.split("/").filter(Boolean);

  // Calendar destinations (meeting scheduled/rescheduled/cancelled,
  // leave OOO, internal meetings) — the mobile calendar lives on the
  // Meetings tab, not inside Me.
  if (path === "/me" && /(^|&)tab=calendar(&|$)/.test(query)) {
    return { route: "/(tabs)/meetings", label: "View calendar" };
  }

  // Self expenses list — mobile Expenses tab shows the same rows.
  if (path === "/me/expenses") {
    return { route: "/(tabs)/expenses", label: "View expenses" };
  }

  // Remaining Me destinations (/me, /me/profile, /me/timesheets, …).
  if (path === "/me" || path.startsWith("/me/")) {
    return { route: "/(tabs)/me", label: "View in Me" };
  }

  // Wallet expenses — the mobile expense detail screen reads the same
  // /wallet/expenses/:id API, so ids are interchangeable.
  if (seg[0] === "wallet" && seg[1] === "expenses") {
    if (seg[2] === "new") return { route: "/expense/new", label: "New expense" };
    if (seg[2]) return { route: `/expense/${seg[2]}`, label: "View expense" };
    return { route: "/(tabs)/expenses", label: "View expenses" };
  }

  return null;
}
