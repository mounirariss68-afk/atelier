/**
 * Task #1194 — web composer attachment upload helpers.
 *
 * Pure/pluggable pieces of the real-upload flow so the logic is unit
 * testable without rendering CommandBar:
 *
 *   uploadCliAttachment — POST one file to the existing CLI attachments
 *     endpoint (multipart `files`) and normalize the response into a
 *     {ok, serverId} | {ok:false, reason} result. The server digest-
 *     dedupes per org, so re-uploading identical bytes returns the same
 *     attachment id.
 *   rejectionMessage    — map server rejection reasons to localized copy.
 *   readyAttachmentIds  — the ids that may ride on a turn (ready only).
 *   hasUploadInFlight   — send must be blocked while true.
 */

import type { CliLocale } from "./types";
import { s } from "./locale";

/** A composer attachment pill with a real upload lifecycle. */
export interface ComposerAttachment {
  id: string;
  name: string;
  size: number;
  mime: string;
  status: "uploading" | "ready" | "failed";
  /** Server-returned attachment id — present only when status="ready". */
  serverId?: string;
  error?: string;
  /** Retained on failed uploads so the pill can offer a retry. */
  file?: File;
}

export type UploadOutcome =
  | { ok: true; serverId: string }
  | { ok: false; reason: string };

interface UploadResponseBody {
  attachmentIds?: string[];
  attachments?: Array<{ ok?: boolean; attachmentId?: string; reason?: string }>;
  error?: string;
  message?: string;
}

/**
 * Upload one file to `POST /api/atelier/cli/attachments`. One request
 * per file so each pill tracks its own lifecycle independently (a
 * rejected file never blocks a good one). Handles the route's
 * partial-success shape: HTTP 200 with `attachments[0].ok === false`.
 */
export async function uploadCliAttachment(
  file: File,
  sessionId: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<UploadOutcome> {
  try {
    const form = new FormData();
    form.append("files", file, file.name);
    if (sessionId) form.append("sessionId", sessionId);
    const res = await fetchImpl("/api/atelier/cli/attachments", {
      method: "POST",
      credentials: "include",
      body: form,
    });
    let data: UploadResponseBody | null = null;
    try {
      data = (await res.json()) as UploadResponseBody;
    } catch {
      /* non-JSON body — treated as a generic failure below */
    }
    if (!res.ok) {
      return { ok: false, reason: data?.error ?? `http-${res.status}` };
    }
    const entry = data?.attachments?.[0];
    if (entry && entry.ok === false) {
      return { ok: false, reason: entry.reason ?? "unknown" };
    }
    const serverId =
      data?.attachmentIds?.[0] ?? (entry?.ok ? entry.attachmentId : undefined);
    if (!serverId) return { ok: false, reason: "no-attachment-id" };
    return { ok: true, serverId };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/** Map server rejection reasons to localized, human-readable messages. */
export function rejectionMessage(reason: string, locale: CliLocale): string {
  if (reason.startsWith("over-size-cap") || reason === "limit-file-size") {
    return s("fileTooLarge", locale);
  }
  if (
    reason === "mime-not-allowed" ||
    reason === "mime-extension-mismatch" ||
    reason === "executable-or-macro"
  ) {
    return s("fileTypeRejected", locale);
  }
  if (reason === "unreadable-document" || reason === "empty-file") {
    return s("fileUnreadable", locale);
  }
  return `${s("uploadFailed", locale)} (${reason})`;
}

/** Only server-acknowledged ids may ride on a turn. */
export function readyAttachmentIds(list: ComposerAttachment[]): string[] {
  return list
    .filter((a) => a.status === "ready" && typeof a.serverId === "string")
    .map((a) => a.serverId!);
}

/** True while any pill's upload is still in flight — send must block. */
export function hasUploadInFlight(list: ComposerAttachment[]): boolean {
  return list.some((a) => a.status === "uploading");
}
