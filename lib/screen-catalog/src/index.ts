/**
 * Task #939 — shared screen catalog: a machine-readable map of the web
 * app's navigable screens (id, title, path, breadcrumb, role visibility,
 * keywords) so the chat assistant can answer "where do I find X?" and
 * hand back a working `navigateTo` link.
 *
 * `catalog.ts` is GENERATED from the web app's real nav definitions
 * (artifacts/atelier/src/lib/lens.ts + peopleLifecycle.ts) by
 * `artifacts/atelier/scripts/generate-screen-catalog.ts`. A `--check`
 * mode of that script is wired as `test:screen-catalog` in the atelier
 * package — the drift guard that fails when nav changes without a
 * regeneration. Never hand-edit catalog.ts.
 */

export interface ScreenEntry {
  /** Stable id, `<area>.<screen>`. */
  id: string;
  /** Human title of the screen ("Opportunities"). */
  title: string;
  /** One-line description of what lives there. */
  description: string;
  /** Web path. May contain `:params` when `parameterized`. */
  path: string;
  /** Location breadcrumb, e.g. ["Clients", "Opportunities"]. */
  breadcrumb: string[];
  /** Extra lexical match terms beyond title/breadcrumb words. */
  keywords: string[];
  /** Persona roles that can see this screen. */
  roles: string[];
  /**
   * True when the path needs a record id (workspace/detail screens) —
   * the assistant should describe the location but return no direct
   * link (`navigateTo: null`).
   */
  parameterized: boolean;
}

export { SCREEN_CATALOG } from "./catalog.js";
import { SCREEN_CATALOG } from "./catalog.js";

/** Screens visible to a persona role. Unknown roles get nothing. */
export function screensForRole(role: string): ScreenEntry[] {
  return SCREEN_CATALOG.filter((s) => s.roles.includes(role));
}

/**
 * Mirrors the mobile app's `internalRouteFor` support surface
 * (artifacts/atelier-mobile/lib/internalRoute.ts): only Me-lens and
 * wallet-expense destinations have mobile screens. Kept as a tiny
 * prefix mirror on purpose — the mobile card itself already degrades
 * (non-pressable) for unmapped paths, this only drives the wording.
 */
export function hasMobileScreen(path: string): boolean {
  return (
    path === "/me" ||
    path.startsWith("/me/") ||
    path.startsWith("/wallet/expenses")
  );
}

const STOPWORDS = new Set([
  "the", "a", "an", "i", "do", "where", "is", "are", "my", "me", "to",
  "in", "on", "of", "for", "find", "see", "go", "how", "can", "page",
  "screen", "tab", "section", "and", "what", "show",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export interface ScreenMatch {
  screen: ScreenEntry;
  score: number;
}

/**
 * Deterministic lexical ranking (no embeddings — offline-testable).
 * Scores per query token: title word 3, keyword 2, breadcrumb word 2,
 * description word 1; prefix matches count half.
 */
export function matchScreens(
  query: string,
  screens: readonly ScreenEntry[],
): ScreenMatch[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];
  const out: ScreenMatch[] = [];
  for (const screen of screens) {
    const title = tokenize(screen.title);
    const crumbs = tokenize(screen.breadcrumb.join(" "));
    const keys = screen.keywords.map((k) => k.toLowerCase());
    const desc = tokenize(screen.description);
    let score = 0;
    for (const qt of qTokens) {
      const hit = (words: string[], pts: number) => {
        if (words.includes(qt)) return pts;
        if (words.some((w) => w.startsWith(qt) || qt.startsWith(w))) return pts / 2;
        return 0;
      };
      score += hit(title, 3);
      score += hit(keys, 2);
      score += hit(crumbs, 2);
      score += hit(desc, 1);
    }
    if (score > 0) out.push({ screen, score });
  }
  out.sort(
    (a, b) => b.score - a.score || a.screen.id.localeCompare(b.screen.id),
  );
  return out;
}
