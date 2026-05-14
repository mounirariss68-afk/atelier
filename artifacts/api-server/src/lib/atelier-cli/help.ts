/**
 * Task #335 — Help endpoint + page-aware suggestion strip.
 *
 * Sourced from the capability catalog so help can never drift from
 * what the orchestrator actually exposes. We never invent prompts —
 * suggestions are filtered to capabilities that:
 *   1. the persona's role can invoke (capabilitiesForPersona), AND
 *   2. declare the requested surface in `surfaceOn` (or `global`).
 *
 * Response shape is intentionally flat + cacheable. The client can
 * pin it for a few minutes and refresh on `CATALOG_SCHEMA_VERSION`
 * change.
 */

import {
  capabilitiesForPersona,
  CATALOG_SCHEMA_VERSION,
  type CapabilityEntry,
  type SurfaceContext,
} from "./capability-catalog.js";
import type { CliPersona } from "./index.js";

export interface HelpEntry {
  id: string;
  module: string;
  toolName: string;
  description: string;
  slashAliases: { en?: string[]; ar?: string[]; fr?: string[] };
  examplePhrases: { en?: string[]; ar?: string[]; fr?: string[] };
  isWrite: boolean;
  irreversible: boolean;
  outboundChannel: string | null;
  surfaceOn: SurfaceContext[];
}

export interface HelpPayload {
  schemaVersion: number;
  groups: Array<{ module: string; entries: HelpEntry[] }>;
}

/** Group the persona-allowed catalog by module (deterministic order). */
export function helpForPersona(persona: CliPersona): HelpPayload {
  const caps = capabilitiesForPersona(persona);
  const byModule = new Map<string, HelpEntry[]>();
  for (const c of caps) {
    const arr = byModule.get(c.module) ?? [];
    arr.push(toHelpEntry(c));
    byModule.set(c.module, arr);
  }
  const groups = Array.from(byModule.entries())
    .map(([module, entries]) => ({
      module,
      entries: entries.sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => a.module.localeCompare(b.module));
  return { schemaVersion: CATALOG_SCHEMA_VERSION, groups };
}

/**
 * Page-aware suggestion strip — used by the composer to render 3-5
 * "you could ask…" chips for the surface the user is currently on.
 *
 * We pick the first English example phrase from each surface-matching
 * capability, prioritising read-only + non-irreversible writes (less
 * scary chips first), then capping at `limit`.
 */
export function suggestionsForSurface(
  persona: CliPersona,
  surface: SurfaceContext,
  limit = 5,
): Array<{ capabilityId: string; toolName: string; phrase: string; isWrite: boolean }> {
  const caps = capabilitiesForPersona(persona).filter(
    (c) =>
      c.surfaceOn.includes(surface) || c.surfaceOn.includes("global"),
  );
  const ranked = caps.slice().sort((a, b) => {
    const aRank = (a.isWrite ? 1 : 0) + (a.irreversible ? 2 : 0);
    const bRank = (b.isWrite ? 1 : 0) + (b.irreversible ? 2 : 0);
    return aRank - bRank;
  });
  const out: Array<{
    capabilityId: string;
    toolName: string;
    phrase: string;
    isWrite: boolean;
  }> = [];
  for (const c of ranked) {
    const phrase = c.examplePhrases?.en?.[0];
    if (!phrase) continue;
    out.push({
      capabilityId: c.id,
      toolName: c.toolName,
      phrase,
      isWrite: c.isWrite,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function toHelpEntry(c: CapabilityEntry): HelpEntry {
  return {
    id: c.id,
    module: c.module,
    toolName: c.toolName,
    description: c.description,
    slashAliases: c.slashAliases,
    examplePhrases: c.examplePhrases ?? {},
    isWrite: c.isWrite,
    irreversible: c.irreversible,
    outboundChannel: c.outboundChannel,
    surfaceOn: c.surfaceOn,
  };
}
