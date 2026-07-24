/**
 * Task #615 — UI-level probe for the Me-tab "tap a saved ID document" flow.
 *
 * Part A drives the extracted openDocumentFile() core (lib/documentOpen.ts)
 * with fake platform deps and pins:
 *   1. Single-file JPG doc: download URL = API base + generated route path,
 *      auth header carried on the download, then the share sheet opens with
 *      the downloaded local file.
 *   2. Combined-PDF national ID: front tap uses the plain route; back tap
 *      appends ?side=back and uses the back file name.
 *   3. hasFile=false (and back tap without hasBackFile) is a strict no-op:
 *      no network, no browser, no share.
 *   4. Web platform opens the URL in the browser instead of downloading.
 *   5. Download failure surfaces as an error result (component shows toast),
 *      never a share attempt.
 *
 * Part B statically pins the me.tsx wiring so the core can't drift away from
 * the screen: document rows call openDocument via onPress with
 * disabled={!doc.hasFile}, the back-side affordance calls openDocument(doc,
 * "back"), and openDocument delegates to openDocumentFile with the generated
 * getAtelierDownloadMyDocumentUrl helper + authHeader.
 *
 * Run: pnpm --filter @workspace/atelier-mobile test:doc-open
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { openDocumentFile, type DocumentOpenDeps, type OpenableDocument } from "../lib/documentOpen";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

// The same route the backend probe (chat-doc-download-probe) pins server-side.
const buildDownloadPath = (id: string) => `/api/atelier/me/documents/${id}/download`;

interface CallLog {
  downloads: { url: string; dest: string; headers: Record<string, string> }[];
  shared: string[];
  webOpens: string[];
}

function makeDeps(log: CallLog, overrides: Partial<DocumentOpenDeps> = {}): DocumentOpenDeps {
  return {
    apiBase: "https://portal.test",
    buildDownloadPath,
    authHeader: () => ({ Authorization: "Bearer session-token" }),
    platformOS: "ios",
    openWebUrl: (url) => {
      log.webOpens.push(url);
    },
    downloadAsync: async (url, dest, options) => {
      log.downloads.push({ url, dest, headers: options.headers });
      return { uri: `file://${dest}` };
    },
    cacheDirectory: "file:///cache/",
    isSharingAvailable: async () => true,
    shareAsync: async (uri) => {
      log.shared.push(uri);
    },
    now: () => 1_700_000_000_000,
    ...overrides,
  };
}

const jpgDoc: OpenableDocument = {
  id: "doc_jpg1",
  title: "Passport",
  hasFile: true,
  fileName: "passport scan.jpg",
};

const nationalId: OpenableDocument = {
  id: "doc_nid1",
  title: "Emirates ID",
  hasFile: true,
  hasBackFile: true,
  fileName: "eid-combined.pdf",
  backFileName: "eid back.pdf",
};

const noFileDoc: OpenableDocument = { id: "doc_none", title: "Visa", hasFile: false };

async function main() {
  // 1. JPG doc: URL, credentials, share.
  {
    const log: CallLog = { downloads: [], shared: [], webOpens: [] };
    const res = await openDocumentFile(jpgDoc, "front", makeDeps(log));
    check("jpg: result is shared", res.status === "shared", res);
    check(
      "jpg: download URL targets the pinned route on the API base",
      log.downloads[0]?.url === "https://portal.test/api/atelier/me/documents/doc_jpg1/download",
      log.downloads[0]?.url,
    );
    check(
      "jpg: auth header carried on the download",
      log.downloads[0]?.headers.Authorization === "Bearer session-token",
      log.downloads[0]?.headers,
    );
    check(
      "jpg: shares the downloaded local file (sanitized name in cache dir)",
      log.shared[0] === "file://file:///cache/1700000000000_passport_scan.jpg".replace("file://file://", "file://") ||
        log.shared[0] === `file://file:///cache/1700000000000_passport_scan.jpg`,
      log.shared,
    );
    check("jpg: no browser fallback on native", log.webOpens.length === 0, log.webOpens);
  }

  // 2. Combined-PDF national ID: front vs back.
  {
    const log: CallLog = { downloads: [], shared: [], webOpens: [] };
    const front = await openDocumentFile(nationalId, "front", makeDeps(log));
    const back = await openDocumentFile(nationalId, "back", makeDeps(log));
    check("nid: front and back both shared", front.status === "shared" && back.status === "shared", { front, back });
    check(
      "nid: front URL has no side param",
      log.downloads[0]?.url === "https://portal.test/api/atelier/me/documents/doc_nid1/download",
      log.downloads[0]?.url,
    );
    check(
      "nid: back URL appends ?side=back",
      log.downloads[1]?.url === "https://portal.test/api/atelier/me/documents/doc_nid1/download?side=back",
      log.downloads[1]?.url,
    );
    check(
      "nid: back download uses the back file name",
      (log.downloads[1]?.dest ?? "").endsWith("_eid_back.pdf"),
      log.downloads[1]?.dest,
    );
  }

  // 3. Disabled states are strict no-ops.
  {
    const log: CallLog = { downloads: [], shared: [], webOpens: [] };
    const res = await openDocumentFile(noFileDoc, "front", makeDeps(log));
    const backOnFrontOnly = await openDocumentFile({ ...jpgDoc, hasBackFile: false }, "back", makeDeps(log));
    check(
      "no file: skipped with zero side effects",
      res.status === "skipped_no_file" &&
        backOnFrontOnly.status === "skipped_no_file" &&
        log.downloads.length === 0 &&
        log.shared.length === 0 &&
        log.webOpens.length === 0,
      { res, backOnFrontOnly, log },
    );
  }

  // 4. Web platform opens the browser instead of downloading.
  {
    const log: CallLog = { downloads: [], shared: [], webOpens: [] };
    const res = await openDocumentFile(jpgDoc, "front", makeDeps(log, { platformOS: "web" }));
    check(
      "web: opens URL in browser, no download/share",
      res.status === "opened_web" &&
        log.webOpens[0] === "https://portal.test/api/atelier/me/documents/doc_jpg1/download" &&
        log.downloads.length === 0 &&
        log.shared.length === 0,
      { res, log },
    );
  }

  // 5. Download failure → structured error, never a share attempt.
  {
    const log: CallLog = { downloads: [], shared: [], webOpens: [] };
    const res = await openDocumentFile(
      jpgDoc,
      "front",
      makeDeps(log, {
        downloadAsync: async () => {
          throw new Error("network down");
        },
      }),
    );
    check(
      "failure: error result and no share",
      res.status === "error" && log.shared.length === 0,
      { res, shared: log.shared },
    );
  }

  // Part B — static wiring pins on me.tsx so the screen can't drift from the core.
  {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, "../app/(tabs)/me.tsx"), "utf8");
    check(
      "me.tsx: row onPress calls openDocument and disables when hasFile is false",
      /onPress=\{\(\) => openDocument\(doc\)\}/.test(src) && /disabled=\{!doc\.hasFile\}/.test(src),
    );
    check('me.tsx: back affordance calls openDocument(doc, "back")', /openDocument\(doc, "back"\)/.test(src));
    check(
      "me.tsx: openDocument delegates to openDocumentFile with generated URL helper + authHeader",
      src.includes("openDocumentFile(doc, side,") &&
        src.includes("buildDownloadPath: getAtelierDownloadMyDocumentUrl") &&
        /authHeader,/.test(src),
    );
    check(
      "me.tsx: error result surfaces the download-failed toast",
      src.includes('result.status === "error"') && src.includes('t("me.downloadFailed")'),
    );
  }

  if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll doc-open probe checks passed");
}

void main();
