/**
 * useActiveLens — derives the current Manage-shell lens (Task #368).
 *
 * Resolution order:
 *   1. URL prefix (`/clients/...`, `/people/...`, etc.) — deep links and
 *      bookmarks always win so a link from email/chat lands in the right
 *      lens before the user has touched the picker.
 *   2. Persisted choice in localStorage, keyed per user id.
 *   3. Persona-derived default (see lens.ts → defaultLensForRole).
 *
 * The setter persists the new choice and navigates to the lens's home page.
 */

import * as React from "react";
import { useLocation } from "wouter";
import {
  type LensId,
  LENSES,
  defaultLensForRole,
  getLens,
  lensFromPath,
  lensStorageKey,
} from "@/lib/lens";

interface UseActiveLensArgs {
  userId: string | null | undefined;
  role: string | null | undefined;
}

interface UseActiveLensResult {
  /** Lens currently shown in the Manage chip. Always one of the five ids. */
  active: LensId;
  /** True when `active` was inferred from the URL prefix (deep-link). */
  fromUrl: boolean;
  /** Switch to a lens — persists + navigates to that lens's home. */
  setLens: (id: LensId) => void;
}

export function useActiveLens({ userId, role }: UseActiveLensArgs): UseActiveLensResult {
  const [location, navigate] = useLocation();

  const urlLens = React.useMemo(() => lensFromPath(location), [location]);

  const [persisted, setPersisted] = React.useState<LensId | null>(() => {
    if (typeof window === "undefined" || !userId) return null;
    try {
      const raw = window.localStorage.getItem(lensStorageKey(userId));
      if (raw && LENSES.some((l) => l.id === raw)) return raw as LensId;
    } catch {
      /* localStorage unavailable — non-fatal */
    }
    return null;
  });

  // Re-hydrate the persisted choice once the user id resolves (data loads
  // async after mount). Without this, the very first render uses the
  // role-default even when a saved choice exists.
  React.useEffect(() => {
    if (typeof window === "undefined" || !userId) return;
    try {
      const raw = window.localStorage.getItem(lensStorageKey(userId));
      if (raw && LENSES.some((l) => l.id === raw)) {
        setPersisted(raw as LensId);
      }
    } catch {
      /* non-fatal */
    }
  }, [userId]);

  // Whenever a deep link drops the user into a lens prefix, mirror that into
  // the persisted choice so a refresh on /clients/foo keeps the chip on
  // Clients even after they navigate to Home.
  React.useEffect(() => {
    if (!urlLens || !userId || typeof window === "undefined") return;
    if (persisted === urlLens) return;
    try {
      window.localStorage.setItem(lensStorageKey(userId), urlLens);
      setPersisted(urlLens);
    } catch {
      /* non-fatal */
    }
  }, [urlLens, userId, persisted]);

  const active: LensId = urlLens ?? persisted ?? defaultLensForRole(role);

  const setLens = React.useCallback(
    (id: LensId) => {
      if (userId && typeof window !== "undefined") {
        try {
          window.localStorage.setItem(lensStorageKey(userId), id);
        } catch {
          /* non-fatal */
        }
      }
      setPersisted(id);
      navigate(getLens(id).prefix);
    },
    [navigate, userId],
  );

  return { active, fromUrl: !!urlLens, setLens };
}
