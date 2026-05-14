/**
 * Task #333 — `/cli` deep-link page. Renders nothing of its own; mounts
 * the CommandBar in `open` mode so URLs like /cli, /cli?prompt=…,
 * /cli?session=…&turn=… deep link straight into the bar.
 *
 * Behavior:
 *  - With `session` / `turn` / `prompt` params → keep the URL, enqueue
 *    a hydration request via CliContext, and let CommandBar drain it
 *    (loading the historical turn into the transcript and focusing the
 *    result card).
 *  - No params → bounce back to the page the user came from so closing
 *    the bar drops them somewhere sensible.
 */

import { useEffect } from "react";
import { useLocation } from "wouter";
import { CliContext } from "@/components/cli/cli-context";
import * as React from "react";

export default function Cli() {
  const [, navigate] = useLocation();
  const ctx = React.useContext(CliContext);
  const params = React.useMemo(() => {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }, []);
  const sessionParam = params.get("session");
  const turnParam = params.get("turn");
  const promptParam = params.get("prompt");

  useEffect(() => {
    if (sessionParam || turnParam || promptParam) {
      // Deep-link: hand off to the bar and keep the URL so the user
      // can copy/share the link to a specific turn.
      ctx.requestHydration({
        sessionId: sessionParam,
        turnId: turnParam,
        prompt: promptParam,
      });
      return;
    }

    // No params → open the bar, then bounce back to the referrer.
    ctx.setOpen(true);
    const back = (() => {
      try {
        const ref = new URL(document.referrer);
        if (ref.origin === window.location.origin && !ref.pathname.startsWith("/cli")) {
          return ref.pathname + ref.search;
        }
      } catch {
        // ignore
      }
      return "/";
    })();
    navigate(back, { replace: true });
  }, [ctx, navigate, sessionParam, turnParam, promptParam]);

  return null;
}
