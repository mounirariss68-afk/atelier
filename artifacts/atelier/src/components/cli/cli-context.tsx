/**
 * Task #333 — singleton open/close context for the command bar.
 *
 * The bar lives at the Shell level so the Cmd+K shortcut, the top-nav
 * button, and the /cli deep-link page all flip the same boolean.
 *
 * Deep-link hydration: /cli?session=…&turn=… can't reach into the
 * CommandBar's internal `useCli` directly, so the page enqueues a
 * hydration request via `requestHydration({ sessionId, turnId? })` and
 * the bar consumes it with `consumeHydration()`. Same shape for
 * `pendingPrompt` (used by /cli?prompt=…). All getters are stable
 * across renders.
 */

import * as React from "react";
import type { CliTurn } from "./types";
import type { CliOpenedSource } from "./telemetry";

export interface CliHydrationRequest {
  sessionId?: string | null;
  turnId?: string | null;
  prompt?: string | null;
}

export interface CliOpenOptions {
  source: CliOpenedSource;
  prompt?: string | null;
  surface?: string | null;
}

export interface CliContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  /** Page → bar hydration handoff. Cleared by the bar after applying. */
  requestHydration: (req: CliHydrationRequest) => void;
  consumeHydration: () => CliHydrationRequest | null;
  /** Turn-injection bridge: the bar registers its useCli callback so
   * the /cli page (or rail click handlers) can land directly on a
   * historical turn. No-op until the bar mounts. */
  registerInjectTurn: (fn: (turn: CliTurn) => void) => void;
  /**
   * Task #342 — single instrumented entry point. Every launcher
   * (header, ⌘K, Home input, Home chip, floating bubble, deep link)
   * calls this so we can attribute opens by `source`. An optional
   * `prompt` is forwarded to the composer via the hydration queue.
   */
  openCli: (opts: CliOpenOptions) => void;
}

export const CliContext = React.createContext<CliContextValue>({
  open: false,
  setOpen: () => {},
  toggle: () => {},
  triggerRef: { current: null },
  requestHydration: () => {},
  consumeHydration: () => null,
  registerInjectTurn: () => {},
  openCli: () => {},
});
