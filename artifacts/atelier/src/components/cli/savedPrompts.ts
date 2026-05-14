/**
 * Task #333 — per-user saved prompts (v1 = localStorage).
 *
 * Firm-wide / team templates are explicitly deferred to a later task.
 * The eventual server table name is reserved as `atelier_cli_shared_prompts`
 * so v1 doesn't paint the v2 schema into a corner — see
 * .local/tasks/task-333.md "Saved-prompt drawer" bullet.
 *
 * Each saved prompt records the catalog `schemaVersion` it was authored
 * against; the drawer surfaces a yellow warning when that version no
 * longer matches the server's current `schemaVersion`.
 */

import type { CliLocale } from "./types";

const KEY = "atelier-cli-saved-prompts-v1";

export interface SavedPrompt {
  id: string;
  label: string;
  prompt: string;
  locale: CliLocale;
  schemaVersionAtSave: number;
  createdAt: number;
}

function readAll(): SavedPrompt[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedPrompt[]) : [];
  } catch {
    return [];
  }
}

function writeAll(rows: SavedPrompt[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    // ignore quota errors
  }
}

export function listSavedPrompts(): SavedPrompt[] {
  return readAll().sort((a, b) => b.createdAt - a.createdAt);
}

export function addSavedPrompt(input: {
  label: string;
  prompt: string;
  locale: CliLocale;
  schemaVersionAtSave: number;
}): SavedPrompt {
  const row: SavedPrompt = {
    id: `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    ...input,
    createdAt: Date.now(),
  };
  writeAll([row, ...readAll()]);
  return row;
}

export function deleteSavedPrompt(id: string): void {
  writeAll(readAll().filter((p) => p.id !== id));
}
