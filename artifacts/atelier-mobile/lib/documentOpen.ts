// Task #615 — pure, dependency-injected core of the Me-tab "tap a saved
// document" flow so the wiring is testable off-device (tests/doc-open-probe.ts).
//
// The component (app/(tabs)/me.tsx) supplies the platform pieces: the
// generated URL helper, auth header, expo-file-system download and
// expo-sharing. This module owns the decision logic:
//   - hasFile / hasBackFile guard (disabled rows are a no-op)
//   - URL = apiBase + generated route path (+ ?side=back for national-ID backs)
//   - web → open in browser; native → download WITH auth headers, then share
//   - errors surface as a structured result (caller shows the toast)

export interface OpenableDocument {
  id: string;
  title: string;
  hasFile: boolean;
  hasBackFile?: boolean;
  fileName?: string | null;
  backFileName?: string | null;
}

export type DocumentSide = "front" | "back";

export interface DocumentOpenDeps {
  apiBase: string;
  /** Generated client helper for the download route, e.g. getAtelierDownloadMyDocumentUrl */
  buildDownloadPath: (documentId: string) => string;
  authHeader: () => Record<string, string>;
  platformOS: string;
  /** Web fallback (Linking.openURL) */
  openWebUrl: (url: string) => void | Promise<void>;
  /** Native download (expo-file-system downloadAsync). `status` (when
   * reported) lets a 404 no-file response surface as `missing_file`
   * instead of sharing a JSON error body. */
  downloadAsync: (
    url: string,
    dest: string,
    options: { headers: Record<string, string> },
  ) => Promise<{ uri: string; status?: number }>;
  /** Optional pre-open probe for the web platform (e.g. a HEAD fetch
   * returning the HTTP status). Without it, web keeps the plain
   * open-in-browser behavior. */
  probeStatus?: (url: string, headers: Record<string, string>) => Promise<number>;
  cacheDirectory: string | null;
  isSharingAvailable: () => Promise<boolean>;
  shareAsync: (uri: string) => Promise<void>;
  now?: () => number;
}

export type DocumentOpenResult =
  | { status: "skipped_no_file" }
  | { status: "missing_file"; url: string }
  | { status: "opened_web"; url: string }
  | { status: "shared"; url: string; localUri: string }
  | { status: "downloaded_no_share"; url: string; localUri: string }
  | { status: "error"; url: string; error: unknown };

export function buildDocumentDownloadUrl(
  doc: Pick<OpenableDocument, "id">,
  side: DocumentSide,
  apiBase: string,
  buildDownloadPath: (documentId: string) => string,
): string {
  const path = buildDownloadPath(doc.id);
  return `${apiBase}${path}${side === "back" ? "?side=back" : ""}`;
}

export function documentDownloadFileName(doc: OpenableDocument, side: DocumentSide): string {
  const raw =
    side === "back" ? (doc.backFileName ?? `${doc.title}-back`) : (doc.fileName ?? `${doc.title}`);
  return raw.replace(/[^\w.\-]+/g, "_");
}

export async function openDocumentFile(
  doc: OpenableDocument,
  side: DocumentSide,
  deps: DocumentOpenDeps,
): Promise<DocumentOpenResult> {
  if (side === "back" ? !doc.hasBackFile : !doc.hasFile) {
    return { status: "skipped_no_file" };
  }
  const url = buildDocumentDownloadUrl(doc, side, deps.apiBase, deps.buildDownloadPath);
  if (deps.platformOS === "web") {
    // Task #838 — probe first (when wired) so a stale hasBackFile flag
    // shows a friendly "back side missing" message, not a raw JSON page.
    if (deps.probeStatus) {
      try {
        const code = await deps.probeStatus(url, deps.authHeader());
        if (code === 404) return { status: "missing_file", url };
        if (code >= 400) return { status: "error", url, error: new Error(`HTTP ${code}`) };
      } catch (error) {
        return { status: "error", url, error };
      }
    }
    await deps.openWebUrl(url);
    return { status: "opened_web", url };
  }
  try {
    const dir = deps.cacheDirectory ?? "";
    const dest = `${dir}${(deps.now ?? Date.now)()}_${documentDownloadFileName(doc, side)}`;
    const result = await deps.downloadAsync(url, dest, { headers: deps.authHeader() });
    // Task #838 — expo downloadAsync writes error bodies too; treat a 404
    // as "file missing" and any other 4xx/5xx as an error, never share it.
    if (result.status === 404) return { status: "missing_file", url };
    if (typeof result.status === "number" && result.status >= 400) {
      return { status: "error", url, error: new Error(`HTTP ${result.status}`) };
    }
    if (await deps.isSharingAvailable()) {
      await deps.shareAsync(result.uri);
      return { status: "shared", url, localUri: result.uri };
    }
    return { status: "downloaded_no_share", url, localUri: result.uri };
  } catch (error) {
    return { status: "error", url, error };
  }
}
