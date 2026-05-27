import type { ReactNode } from "react";
import { useDemoRtl } from "./useDemoRtl";

export interface UserDemoShellProps {
  /** Active language. Drives the document `dir` attribute via `useDemoRtl`. */
  lang: "en" | "ar";
  /** Optional full-width header rendered above sidebar+main (e.g. navy header). */
  header?: ReactNode;
  /** Sidebar slot — hosts brand block, nav, language toggle, collapse, etc. */
  sidebar: ReactNode;
  /**
   * Inline topbar slot rendered above the main content. Hosts the persona
   * pill, notifications bell, language toggle, AI assistant button, and any
   * "switch view" links the demo uses.
   */
  topbar?: ReactNode;
  /** Slot rendered between the topbar and the main content (filter bar, KPI strip). */
  belowTopbar?: ReactNode;
  /** Main view body. */
  children: ReactNode;
  /** Floating action button (AI chat trigger). */
  fab?: ReactNode;
  /**
   * Fixed-position drawers (notification side panel, AI chat panel). Render
   * them inside an AnimatePresence so consumers can keep their own animation
   * choices.
   */
  drawers?: ReactNode;
  /** Outer canvas color. Defaults to the project's neutral canvas. */
  background?: string;
  /** Outer text color. Defaults to navy ink. */
  textColor?: string;
  /** Make the shell occupy the viewport. "screen" uses h-screen overflow-hidden, "min" uses min-h-screen. */
  height?: "screen" | "min";
  /** Optional `data-testid` for the outer container. */
  testId?: string;
  /** Inter font is the project standard — flip off for demos with a custom font. */
  applyInterFont?: boolean;
}

/**
 * Shared frame used by every user-facing demo. The shell is intentionally a
 * thin layout primitive: it manages the document RTL effect and arranges the
 * sidebar / header / topbar / main / drawers / FAB slots. Each demo composes
 * the slot contents using the building blocks exported from this directory
 * (`DemoSidebarNav`, `DemoBrandBlock`, `DemoLangToggle`, `DemoPersonaPill`,
 * `DemoNotifBell`, `DemoCollapseToggle`).
 *
 * Two layout shapes are supported by the same component:
 *  1. `sidebar + topbar`  — sidebar holds the brand; topbar above main content.
 *     Used by enterprise-knowledge, programme-war-room, sovereign-data,
 *     network-ops, citizen-services, customer-care.
 *  2. `header + sidebar`  — full-width navy header at top hosts the
 *     persona/notif/lang controls; sidebar below holds only nav + AI button.
 *     Used by procurement-negotiation, sama-compliance, tender-response-studio,
 *     value-realization.
 *
 * Pass `header` for layout #2 and skip `topbar`; or pass `topbar` for layout
 * #1 and skip `header`. Tender-response-studio passes BOTH (navy sidebar with
 * its own brand block under a navy header).
 */
export default function UserDemoShell({
  lang,
  header,
  sidebar,
  topbar,
  belowTopbar,
  children,
  fab,
  drawers,
  background = "#F4F6F8",
  textColor = "#0A1230",
  height = "screen",
  testId,
  applyInterFont = true,
}: UserDemoShellProps) {
  useDemoRtl(lang);
  const isAr = lang === "ar";
  const heightCls = height === "screen" ? "h-screen overflow-hidden" : "min-h-screen";

  const fontStyle = applyInterFont ? { fontFamily: "Inter, system-ui, -apple-system" } : undefined;

  if (header) {
    // header + sidebar layout
    return (
      <div
        dir={isAr ? "rtl" : "ltr"}
        data-testid={testId}
        className={`${heightCls} flex flex-col`}
        style={{ background, color: textColor, ...fontStyle }}
      >
        <div className="flex-shrink-0 z-20">{header}</div>
        <div className="flex-1 min-h-0 flex">
          <aside className="flex-shrink-0 flex flex-col">{sidebar}</aside>
          <div className="flex-1 min-w-0 flex flex-col">
            {topbar && <div className="flex-shrink-0">{topbar}</div>}
            {belowTopbar && <div className="flex-shrink-0">{belowTopbar}</div>}
            <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
          </div>
        </div>
        {fab}
        {drawers}
      </div>
    );
  }

  // sidebar + topbar layout
  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      data-testid={testId}
      className={`${heightCls} flex`}
      style={{ background, color: textColor, ...fontStyle }}
    >
      <aside className="flex-shrink-0 flex flex-col">{sidebar}</aside>
      <main className="flex-1 flex flex-col min-w-0 min-h-0">
        {topbar && <div className="flex-shrink-0">{topbar}</div>}
        {belowTopbar && <div className="flex-shrink-0">{belowTopbar}</div>}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{children}</div>
      </main>
      {fab}
      {drawers}
    </div>
  );
}
