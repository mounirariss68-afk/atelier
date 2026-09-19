// Task #828 — refresh cached Me data after chat writes.
//
// A chat write that commits (e.g. attaching the back of a national ID via
// the attach_my_document_file tool) updates the server, but the Me tab's
// React Query cache kept serving the stale document list until app
// restart ("Back side missing" never cleared). The web CLI already
// invalidates its documents query after writes; this is the mobile
// equivalent.
//
// General mechanism, not a per-tool one-off: the server-owned semantic
// envelope marks committed outcomes and carries the validated destination.
// Raw tool payloads are evidence only and never authorize invalidation.
import type { QueryClient } from "@tanstack/react-query";
import {
  getAtelierGetMyProfileQueryKey,
  getAtelierListMyDocumentsQueryKey,
} from "@workspace/api-client-react";

type QueryKeyLike = readonly unknown[];

/** navigateTo path prefix → cached queries a commit there may have changed. */
const COMMIT_PATH_INVALIDATIONS: { prefix: string; keys: () => QueryKeyLike[] }[] = [
  {
    // Personal documents + profile writes (attach/replace scan, save or
    // delete a document, profile edits) all land on /me/profile.
    prefix: "/me/profile",
    keys: () => [getAtelierListMyDocumentsQueryKey(), getAtelierGetMyProfileQueryKey()],
  },
];

/** Minimal shape of an SSE frame as passed to the chat reducer. */
interface TurnLike {
  protocolMode?: string;
  commitState?: string;
  lastSequence?: number;
  navigateTo?: { path?: unknown; when?: unknown } | null;
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/**
 * Pure part (unit-tested): given a raw chat SSE frame, return the query
 * keys that should be invalidated, or [] when the frame is not a
 * committed write touching a mapped path.
 */
export function commitInvalidationKeys(previous: TurnLike, next: TurnLike): QueryKeyLike[] {
  if (next.protocolMode !== "current") return [];
  if (previous.commitState === "committed" || next.commitState !== "committed") return [];
  if (
    typeof previous.lastSequence === "number" &&
    typeof next.lastSequence === "number" &&
    next.lastSequence <= previous.lastSequence
  ) {
    return [];
  }
  const nav = asObj(next.navigateTo);
  if (nav.when !== "on_commit" || typeof nav.path !== "string") return [];
  const path = nav.path;
  const out: QueryKeyLike[] = [];
  for (const rule of COMMIT_PATH_INVALIDATIONS) {
    if (path === rule.prefix || path.startsWith(`${rule.prefix}/`) || path.startsWith(`${rule.prefix}?`)) {
      out.push(...rule.keys());
    }
  }
  return out;
}

/** Effectful wrapper wired into the chat stream's onFrame. Best-effort. */
export function applyChatCommitInvalidations(
  queryClient: QueryClient,
  previous: TurnLike,
  next: TurnLike,
): void {
  try {
    for (const queryKey of commitInvalidationKeys(previous, next)) {
      void queryClient.invalidateQueries({ queryKey });
    }
  } catch {
    // Invalidation is a freshness optimization — never break the stream.
  }
}
