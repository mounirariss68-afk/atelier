/**
 * Task #1017 — node-safe core of the per-category push-alert preferences.
 *
 * The server stores opt-OUTS on the user row (missing key = enabled) and
 * exposes them through GET/PATCH /api/atelier/me/preferences as a fully
 * resolved `pushCategories` record. PATCH accepts a PARTIAL record so a
 * single toggle round-trips one key only.
 */
export const PREFERENCES_PATH = "/api/atelier/me/preferences";

export const PUSH_CATEGORIES = [
  "tasks",
  "expenses",
  "timesheets",
  "approvals",
  "agreements",
  "other",
] as const;
export type PushCategory = (typeof PUSH_CATEGORIES)[number];

export type PushPrefsApi = <T = unknown>(
  path: string,
  opts?: { method?: string; body?: unknown },
) => Promise<T>;

export interface PushPrefsResponse {
  pushCategories: Record<PushCategory, boolean>;
}

export function fetchPushCategories(api: PushPrefsApi): Promise<PushPrefsResponse> {
  return api<PushPrefsResponse>(PREFERENCES_PATH);
}

/** Persist ONE category toggle; throws on failure so callers can revert. */
export function changePushCategory(
  api: PushPrefsApi,
  category: PushCategory,
  enabled: boolean,
): Promise<PushPrefsResponse> {
  return api<PushPrefsResponse>(PREFERENCES_PATH, {
    method: "PATCH",
    body: { pushCategories: { [category]: enabled } },
  });
}
