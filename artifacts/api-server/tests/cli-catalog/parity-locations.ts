/**
 * Task #801 — keep the /me chat-parity registry's "do it here instead"
 * directions honest as the UI moves.
 *
 * The registry (me-chat-parity.ts) hardcodes UI locations like
 * "Me → Pay & Benefits (Request bank change)" (web) and
 * "Settings tab → Microsoft 365" (mobile). If a web Me section is
 * renamed/moved in the lens registry, or a mobile tab is renamed, chat
 * would confidently direct users to a place that no longer exists.
 *
 * These helpers parse the location strings and extract the CURRENT
 * source-of-truth labels:
 *   - web:    Me-lens section labels from artifacts/atelier/src/lib/lens.ts
 *   - mobile: tab titles from app/(tabs)/_layout.tsx + English i18n strings
 *
 * Pure text parsing (readFileSync + regex) on purpose: the web/mobile
 * sources import framework aliases the api-server cannot load, and this
 * suite must stay runnable without building either client.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WEB_LENS_FILE = fileURLToPath(
  new URL("../../../atelier/src/lib/lens.ts", import.meta.url),
);
const MOBILE_TABS_LAYOUT = fileURLToPath(
  new URL("../../../atelier-mobile/app/(tabs)/_layout.tsx", import.meta.url),
);
const MOBILE_I18N = fileURLToPath(
  new URL("../../../atelier-mobile/constants/i18n.ts", import.meta.url),
);

/** Me-lens section labels currently defined in the web lens registry. */
export function currentMeSectionLabels(): Set<string> {
  const src = readFileSync(WEB_LENS_FILE, "utf8");
  const labels = new Set<string>();
  // Sections belong to the Me lens iff their href lives under /me.
  const re = /label:\s*"([^"]+)",\s*href:\s*"\/me(?:\/[^"]*)?"/g;
  for (let m = re.exec(src); m; m = re.exec(src)) labels.add(m[1]);
  if (labels.size === 0) {
    throw new Error(
      `parity-locations: extracted ZERO Me-lens section labels from ${WEB_LENS_FILE} — ` +
        "the lens.ts shape changed; update the extraction regex in parity-locations.ts",
    );
  }
  return labels;
}

/** English titles of the mobile bottom tabs, keyed off the (tabs) layout. */
export function currentMobileTabTitles(): Set<string> {
  const layout = readFileSync(MOBILE_TABS_LAYOUT, "utf8");
  const i18n = readFileSync(MOBILE_I18N, "utf8");
  const keys: string[] = [];
  const keyRe = /<Tabs\.Screen\s+name="[^"]+"\s+options=\{\{\s*title:\s*t\("(tab\.[a-zA-Z0-9_.-]+)"\)/g;
  for (let m = keyRe.exec(layout); m; m = keyRe.exec(layout)) keys.push(m[1]);
  if (keys.length === 0) {
    throw new Error(
      `parity-locations: extracted ZERO tab title keys from ${MOBILE_TABS_LAYOUT} — ` +
        "the tabs layout shape changed; update the extraction regex in parity-locations.ts",
    );
  }
  const titles = new Set<string>();
  for (const key of keys) {
    // First occurrence in i18n.ts is the English catalog.
    const m = i18n.match(new RegExp(`"${key.replace(/\./g, "\\.")}":\\s*"([^"]+)"`));
    if (!m) {
      throw new Error(
        `parity-locations: mobile tab key "${key}" has no English string in ${MOBILE_I18N}`,
      );
    }
    titles.add(m[1]);
  }
  return titles;
}

/**
 * Parse a registry web location ("Me → Pay & Benefits (Request bank
 * change)") into the lens label + section label it references. Returns
 * null when the string doesn't follow the "Lens → Section" convention.
 */
export function parseWebLocation(
  web: string,
): { lens: string; section: string } | null {
  const m = web.match(/^([^→(]+?)\s*→\s*([^(→]+?)(?:\s*\(.*\))?$/);
  if (!m) return null;
  return { lens: m[1].trim(), section: m[2].trim() };
}

/**
 * Parse a registry mobile location ("Settings tab → Microsoft 365",
 * "Expenses tab (open the claim…)") into the tab title it references.
 */
export function parseMobileLocation(mobile: string): { tab: string } | null {
  const m = mobile.match(/^(.+?)\s+tab\b/);
  if (!m) return null;
  return { tab: m[1].trim() };
}
