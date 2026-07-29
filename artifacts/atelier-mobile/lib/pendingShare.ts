// Task #748 — pending-share store for files shared into the app via the OS
// share sheet (expo-share-intent). The share can arrive before auth is
// established (cold start from the share extension, logged-out user), so the
// file is held here until the New Expense screen is ready to consume it.
//
// Module-level state on purpose: it must survive the login navigation but
// never persist across app restarts (the extension re-delivers on relaunch).

export interface PendingShare {
  uri: string;
  mime: string;
  fileName: string | null;
  size: number | null;
  receivedAt: number;
}

let pending: PendingShare | null = null;
let version = 0;
const listeners = new Set<() => void>();

export function setPendingShare(share: PendingShare): void {
  pending = share;
  version += 1;
  for (const l of [...listeners]) l();
}

/** One-shot: the consumer takes ownership of the file. */
export function consumePendingShare(): PendingShare | null {
  const p = pending;
  pending = null;
  return p;
}

export function hasPendingShare(): boolean {
  return pending !== null;
}

export function getPendingShareVersion(): number {
  return version;
}

export function subscribePendingShare(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------------------------------------------------------------------
// File-type classification. The server receipt parser accepts JPEG/PNG/WebP
// images and PDFs. HEIC/HEIF arrives raw from the iOS share sheet (unlike the
// image picker, which transcodes) and must be converted before upload.
// ---------------------------------------------------------------------------

export type ShareKind = "image" | "pdf" | "heic" | "unsupported";

/**
 * Pure navigation decision for the share handoff. The auth Gate runs its own
 * redirects (login → tabs) in the same transition, so the handler must be
 * route-aware and keep retrying until the New Expense screen is actually in
 * front — the pending share is only cleared when that screen consumes it.
 */
export function shareNavigationAction(state: {
  ready: boolean;
  token: string | null;
  mustChangePassword: boolean;
  seg0: string | undefined;
  seg1: string | undefined;
  pending: boolean;
}): "navigate" | "wait" {
  if (!state.pending) return "wait";
  if (!state.ready || !state.token || state.mustChangePassword) return "wait";
  // Only the New Expense screen consumes pending shares — other expense
  // routes (detail/edit) must not suppress navigation or the share strands.
  if (state.seg0 === "expense" && state.seg1 === "new") return "wait";
  return "navigate";
}

const IMAGE_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const HEIC_MIMES = new Set(["image/heic", "image/heif"]);

export function classifyShareFile(fileName: string | null, mime: string | null): ShareKind {
  const m = (mime ?? "").toLowerCase().split(";")[0].trim();
  const ext = (fileName ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (m === "application/pdf" || (!m && ext === "pdf")) return "pdf";
  if (HEIC_MIMES.has(m) || ext === "heic" || ext === "heif") return "heic";
  if (IMAGE_MIMES.has(m)) return "image";
  if (!m && (ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "webp")) return "image";
  return "unsupported";
}
