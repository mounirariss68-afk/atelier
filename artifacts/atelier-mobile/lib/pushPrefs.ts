/**
 * Task #1017 — per-category push-alert preferences hook (server-persisted,
 * follows the user across devices). Optimistic toggle with revert on
 * failure, mirroring the display-currency pattern.
 */
import { useEffect, useState } from "react";

import { apiJson } from "@/lib/api";
import {
  PUSH_CATEGORIES,
  type PushCategory,
  changePushCategory,
  fetchPushCategories,
} from "@/lib/pushPrefsCore";

const ALL_ON = Object.fromEntries(PUSH_CATEGORIES.map((c) => [c, true])) as Record<
  PushCategory,
  boolean
>;

export function usePushPrefs() {
  const [categories, setCategories] = useState<Record<PushCategory, boolean>>(ALL_ON);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchPushCategories(apiJson)
      .then((r) => {
        if (!alive) return;
        if (r.pushCategories) setCategories({ ...ALL_ON, ...r.pushCategories });
        setLoaded(true);
      })
      .catch(() => {
        // best effort — toggles show all-on until reachable
      });
    return () => {
      alive = false;
    };
  }, []);
  const toggle = async (category: PushCategory, enabled: boolean) => {
    const prev = categories;
    setCategories({ ...categories, [category]: enabled });
    try {
      await changePushCategory(apiJson, category, enabled);
    } catch {
      setCategories(prev);
    }
  };
  return { categories, loaded, toggle };
}
