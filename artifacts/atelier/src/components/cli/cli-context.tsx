/**
 * Task #333 — singleton open/close context for the command bar.
 *
 * The bar lives at the Shell level so the Cmd+K shortcut, the top-nav
 * button, and the /cli deep-link page all flip the same boolean.
 */

import * as React from "react";

export interface CliContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
}

export const CliContext = React.createContext<CliContextValue>({
  open: false,
  setOpen: () => {},
  toggle: () => {},
  triggerRef: { current: null },
});
