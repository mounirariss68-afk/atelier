import * as React from "react";
import { useLocation } from "wouter";

/**
 * Permanent client-side redirect that preserves the URL search string by
 * default. If `to` already contains its own `?` query, the incoming
 * search is merged in (incoming params win on conflict) so we never emit
 * `?a=1?b=2`. Used by Task #369 to keep `/crm`, `/opportunities`,
 * `/engagements`, `/win-loss`, etc. resolving after the commercial loop
 * moved under `/clients/*`.
 */
export function Redirect({ to }: { to: string }) {
  const [, navigate] = useLocation();
  React.useEffect(() => {
    const incoming =
      typeof window !== "undefined" ? window.location.search : "";
    let target = to;
    if (incoming) {
      const qIdx = to.indexOf("?");
      if (qIdx === -1) {
        target = `${to}${incoming}`;
      } else {
        const merged = new URLSearchParams(to.slice(qIdx + 1));
        new URLSearchParams(incoming).forEach((v, k) => {
          if (!merged.has(k)) merged.set(k, v);
        });
        target = `${to.slice(0, qIdx)}?${merged.toString()}`;
      }
    }
    navigate(target, { replace: true });
  }, [to, navigate]);
  return null;
}
