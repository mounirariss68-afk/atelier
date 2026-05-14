/**
 * Task #333 — `/cli` deep-link page. Renders nothing of its own; mounts
 * the CommandBar in `open` mode so URLs like /cli, /cli?prompt=… deep
 * link straight into the bar. Closing the bar from this route returns
 * the user to wherever they came from (or `/` as a fallback).
 */

import { useEffect } from "react";
import { useLocation } from "wouter";
import { CliContext } from "@/components/cli/cli-context";
import * as React from "react";

export default function Cli() {
  const [, navigate] = useLocation();
  const ctx = React.useContext(CliContext);
  useEffect(() => {
    ctx.setOpen(true);
    // After mounting, replace /cli with the path we came from so closing
    // the bar drops us somewhere sensible. We use the document referrer
    // when available; otherwise Home.
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
  }, [ctx, navigate]);
  return null;
}
