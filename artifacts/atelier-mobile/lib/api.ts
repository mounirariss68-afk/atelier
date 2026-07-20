import { triggerUnauthorized } from "@/lib/authEvents";
import { getTokenSync } from "@/lib/token";

export const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

export class HttpError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, data: unknown, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.status = status;
    this.data = data;
  }
}

interface JsonOpts {
  method?: string;
  body?: unknown;
  auth?: boolean;
  headers?: Record<string, string>;
}

/**
 * JSON fetch against the remote API server. Attaches the bearer token,
 * throws HttpError on non-2xx, and routes any 401 through the global
 * unauthorized handler (clears the session + returns to login).
 */
export async function apiJson<T = unknown>(
  path: string,
  opts: JsonOpts = {},
): Promise<T> {
  const { method = "GET", body, auth = true, headers = {} } = opts;
  const h: Record<string, string> = {
    Accept: "application/json",
    ...headers,
  };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (auth) {
    const token = getTokenSync();
    if (token) h.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && auth) triggerUnauthorized();
    throw new HttpError(res.status, data);
  }
  return data as T;
}

export function authHeader(): Record<string, string> {
  const token = getTokenSync();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface UploadedAttachment {
  id: string;
  name: string;
}

/**
 * Upload a single file to the CLI attachment endpoint via multipart/form-data.
 * Returns the server-assigned attachment id, ready to ride on a chat turn.
 */
export async function uploadCliAttachment(
  file: { uri: string; name: string; mime: string },
  sessionId?: string | null,
): Promise<UploadedAttachment> {
  const form = new FormData();
  form.append("files", {
    // React Native's fetch understands this file descriptor shape.
    uri: file.uri,
    name: file.name,
    type: file.mime,
  } as unknown as Blob);
  if (sessionId) form.append("sessionId", sessionId);
  const res = await fetch(`${API_BASE}/api/atelier/cli/attachments`, {
    method: "POST",
    headers: { ...authHeader() },
    body: form,
  });
  if (res.status === 401) {
    triggerUnauthorized();
    throw new HttpError(401, null);
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) throw new HttpError(res.status, data);
  const d = data as { attachmentId?: string; results?: { attachmentId?: string }[] };
  const id = d.attachmentId ?? d.results?.[0]?.attachmentId;
  if (!id) throw new HttpError(500, data);
  return { id, name: file.name };
}

export interface CliSessionMeta {
  id: string;
  title: string | null;
  turnCount: number;
  lastTurnAt: string | null;
}

export async function listCliSessions(): Promise<CliSessionMeta[]> {
  const j = await apiJson<{ sessions?: CliSessionMeta[] }>(
    "/api/atelier/cli/sessions",
  );
  return j.sessions ?? [];
}

/** PUT raw bytes of a local file URI to a signed upload URL. */
export async function putFileToSignedUrl(
  uploadURL: string,
  uri: string,
  mime: string,
): Promise<void> {
  const FileSystem = await import("expo-file-system/legacy");
  await FileSystem.uploadAsync(uploadURL, uri, {
    httpMethod: "PUT",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { "Content-Type": mime },
  });
}
