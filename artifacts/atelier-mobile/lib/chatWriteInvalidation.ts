// Task #828 — refresh cached Me data after chat writes.
//
// A chat write that commits (e.g. attaching the back of a national ID via
// the attach_my_document_file tool) updates the server, but the Me tab's
// React Query cache kept serving the stale document list until app
// restart ("Back side missing" never cleared). The web CLI already
// invalidates its documents query after writes; this is the mobile
// equivalent.
//
// General mechanism, not a per-tool one-off: committed write tool_result
// frames carry a `navigateTo: { path, when: "on_commit" }` hint (the
// chat write-capability contract REQUIRES navigateTo on commit-success),
// so the destination path is a reliable, tool-agnostic signal for which
// cached queries the write touched. Map path prefixes → query keys and
// invalidate on every committed write frame. Pre-confirm previews
// (prelude / pending-confirmation frames) never carry an on_commit
// navigateTo, so they cannot trigger a refetch.
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
interface FrameLike {
  type?: string;
  data?: unknown;
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/**
 * Pure part (unit-tested): given a raw chat SSE frame, return the query
 * keys that should be invalidated, or [] when the frame is not a
 * committed write touching a mapped path.
 */
export function commitInvalidationKeys(frame: FrameLike): QueryKeyLike[] {
  if (frame?.type !== "tool_result") return [];
  const fd = asObj(frame.data);
  if (fd.ok !== true) return [];
  // Pre-confirm preview cards are streamed with prelude=true — the write
  // has NOT happened yet.
  if (fd.prelude === true) return [];
  const payload = asObj(fd.data);
  const nav = asObj(payload.navigateTo);
  // Only a committed write carries navigateTo.when === "on_commit".
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
export function applyChatCommitInvalidations(queryClient: QueryClient, frame: FrameLike): void {
  try {
    for (const queryKey of commitInvalidationKeys(frame)) {
      void queryClient.invalidateQueries({ queryKey });
    }
  } catch {
    // Invalidation is a freshness optimization — never break the stream.
  }
}
