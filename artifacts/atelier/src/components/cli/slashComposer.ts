/**
 * Task #297 / #315 — pure slash-command composer logic for CommandBar.
 *
 * These two behaviors were regression-prone keyboard interactions found in
 * a real browser run (see .agents/memory/cli-slash-command-ux.md):
 *
 *  1. Catalog `slashAliases` are stored WITH the leading slash. Picking a
 *     candidate must strip it before re-inserting, or the composer ends up
 *     with "//contract-prepare".
 *  2. While the slash suggestion menu is open, Enter re-picks the highlighted
 *     candidate and resets the composer. The menu must therefore close as
 *     soon as the user has typed arguments after the command token, so Enter
 *     submits the prompt unchanged.
 *
 * CommandBar.tsx consumes these helpers directly; the tsx test suite
 * (slashComposer.test.ts) pins both behaviors.
 */

import type { CliCapability, CliLocale } from "./types";

/** The composer text produced by picking a slash candidate: a single leading
 * slash plus the locale's first alias (falling back to en, then toolName),
 * with a trailing space so the user can type arguments immediately. */
export function slashInsertionText(c: CliCapability, locale: CliLocale): string {
  const alias = c.slashAliases[locale]?.[0] ?? c.slashAliases.en?.[0] ?? c.toolName;
  // Aliases in the catalog carry a leading "/" already — strip it so
  // picking a candidate never yields "//contract-prepare".
  return `/${alias.replace(/^\/+/, "")} `;
}

/** True once the user has typed at least one non-space argument character
 * after the slash-command token, e.g. "/contract-prepare u". */
export function slashInputHasArgs(input: string): boolean {
  return /^\/\S+\s+\S/.test(input);
}

/** Whether the slash suggestion menu should be open for the current input.
 * It must CLOSE once arguments are present — while it is open, Enter picks
 * the highlighted candidate instead of submitting the turn. */
export function shouldSlashMenuOpen(input: string, candidateCount: number): boolean {
  return input.startsWith("/") && !slashInputHasArgs(input) && candidateCount > 0;
}

/** What a plain Enter (no shift) in the composer should do given the current
 * slash-menu state. Mirrors the ordering in CommandBar.onComposerKey. */
export function enterAction(opts: {
  slashOpen: boolean;
  hasHighlightedCandidate: boolean;
}): "pick" | "submit" {
  return opts.slashOpen && opts.hasHighlightedCandidate ? "pick" : "submit";
}
