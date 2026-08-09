/**
 * Task #827 — display currency preference, persisted server-side so it
 * follows the user across devices. Falls back to USD until loaded.
 *
 * The PATCH + expense-list invalidation lives in displayCurrencyCore.ts
 * (node-safe) so tests/display-currency-probe.ts can pin the behaviour.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { apiJson } from "@/lib/api";
import { changeDisplayCurrency, fetchDisplayCurrency } from "@/lib/displayCurrencyCore";

export function useDisplayCurrency() {
  const queryClient = useQueryClient();
  const [currency, setCurrency] = useState("USD");
  const [supported, setSupported] = useState<string[]>(["USD"]);
  useEffect(() => {
    let alive = true;
    fetchDisplayCurrency(apiJson)
      .then((r) => {
        if (!alive) return;
        setCurrency(r.displayCurrency);
        setSupported(r.supportedCurrencies);
      })
      .catch(() => {
        // best effort — picker just shows USD until reachable
      });
    return () => {
      alive = false;
    };
  }, []);
  const update = async (next: string) => {
    const prev = currency;
    setCurrency(next);
    try {
      await changeDisplayCurrency(apiJson, queryClient, next);
    } catch {
      setCurrency(prev);
    }
  };
  return { currency, supported, update };
}
