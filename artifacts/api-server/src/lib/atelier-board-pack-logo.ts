/**
 * Atelier board-pack logo loader.
 *
 * The board-pack PDF (financeReportsRoutes) embeds the navy Cognirise
 * wordmark on its printed white surface. The asset is owned by the sibling
 * `atelier` artifact (artifacts/atelier/public/cognirise-logo-light.png) and
 * read from disk at run time — it is NOT bundled into the api-server output.
 *
 * Because the bundled entrypoint collapses to a single file at
 * `artifacts/api-server/dist/index.mjs`, the dist-relative path differs from
 * the src-relative path used when running under tsx (tests / dev). We try both
 * candidates so the loader resolves the same asset in either context, and so a
 * test can exercise the real resolution without a dist build.
 *
 * Returns null only if every candidate fails — that is the silent-branding
 * failure mode that `tests/board-pack-logo/run.ts` guards against.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Relative paths to the atelier logo asset, tried in order. */
export const BOARD_PACK_LOGO_CANDIDATES = [
  // Bundled output: artifacts/api-server/dist/index.mjs → artifacts/atelier/public
  "../../atelier/public/cognirise-logo-light.png",
  // Source (tsx): artifacts/api-server/src/lib/ → artifacts/atelier/public
  "../../../atelier/public/cognirise-logo-light.png",
] as const;

/** Read the navy board-pack logo, or null if the asset can't be located. */
export function loadBoardPackLogo(): Buffer | null {
  for (const rel of BOARD_PACK_LOGO_CANDIDATES) {
    try {
      return readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
    } catch {
      // Try the next candidate path.
    }
  }
  return null;
}
