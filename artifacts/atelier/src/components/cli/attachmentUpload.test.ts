/**
 * Task #1194 — unit tests for the web composer's real upload flow.
 *
 * Vitest is not installed in the atelier artifact (matching
 * useCli.test.ts). Run with:
 *
 *   pnpm --filter @workspace/atelier test:cli-attachment-upload
 *
 * Throws (exit 1) on any failed assertion.
 */
import assert from "node:assert/strict";
import {
  uploadCliAttachment,
  rejectionMessage,
  readyAttachmentIds,
  hasUploadInFlight,
  type ComposerAttachment,
} from "./attachmentUpload";

let pass = 0;
let fail = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail++;
    console.error(`  ✗ ${name}\n      ${err instanceof Error ? err.stack : String(err)}`);
  }
}

function fakeFile(name: string): File {
  return new File([Buffer.from("dummy-bytes")], name, { type: "application/pdf" });
}

function fakeFetch(
  status: number,
  body: unknown,
  capture?: { url?: string; form?: FormData },
): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    if (capture) {
      capture.url = String(url);
      capture.form = init?.body as FormData;
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (body === undefined) throw new Error("no body");
        return body;
      },
    } as Response;
  }) as typeof fetch;
}

const run = async () => {
  await test("success response yields the server attachment id", async () => {
    const capture: { url?: string; form?: FormData } = {};
    const out = await uploadCliAttachment(
      fakeFile("invoice.pdf"),
      "sess_1",
      fakeFetch(
        200,
        {
          attachmentIds: ["clatt_abc"],
          attachments: [{ ok: true, attachmentId: "clatt_abc" }],
        },
        capture,
      ),
    );
    assert.deepEqual(out, { ok: true, serverId: "clatt_abc" });
    assert.equal(capture.url, "/api/atelier/cli/attachments");
    // multipart field name must match the server route (`files`) and
    // carry the sessionId so the ingest is session-linked.
    assert.ok(capture.form instanceof FormData);
    assert.equal((capture.form!.get("files") as File).name, "invoice.pdf");
    assert.equal(capture.form!.get("sessionId"), "sess_1");
  });

  await test("dedupe: same bytes → server returns the existing id, we surface it", async () => {
    const out = await uploadCliAttachment(
      fakeFile("invoice.pdf"),
      null,
      fakeFetch(200, {
        attachmentIds: ["clatt_existing"],
        attachments: [{ ok: true, attachmentId: "clatt_existing" }],
      }),
    );
    assert.deepEqual(out, { ok: true, serverId: "clatt_existing" });
  });

  await test("HTTP-200 partial rejection surfaces the per-file reason", async () => {
    const out = await uploadCliAttachment(
      fakeFile("garbage.pdf"),
      null,
      fakeFetch(200, {
        attachmentIds: [],
        attachments: [{ ok: false, attachmentId: "clatt_x", reason: "unreadable-document" }],
      }),
    );
    assert.deepEqual(out, { ok: false, reason: "unreadable-document" });
  });

  await test("HTTP 413 (multer size cap) maps to its error code", async () => {
    const out = await uploadCliAttachment(
      fakeFile("big.pdf"),
      null,
      fakeFetch(413, { error: "limit-file-size", message: "File too large" }),
    );
    assert.deepEqual(out, { ok: false, reason: "limit-file-size" });
  });

  await test("non-JSON error body degrades to http-<status>", async () => {
    const out = await uploadCliAttachment(fakeFile("a.pdf"), null, fakeFetch(502, undefined));
    assert.deepEqual(out, { ok: false, reason: "http-502" });
  });

  await test("network error yields ok:false, never throws", async () => {
    const throwingFetch = (async () => {
      throw new TypeError("network down");
    }) as typeof fetch;
    const out = await uploadCliAttachment(fakeFile("a.pdf"), null, throwingFetch);
    assert.deepEqual(out, { ok: false, reason: "network" });
  });

  await test("missing id in an otherwise-OK response is a failure", async () => {
    const out = await uploadCliAttachment(
      fakeFile("a.pdf"),
      null,
      fakeFetch(200, { attachmentIds: [], attachments: [] }),
    );
    assert.deepEqual(out, { ok: false, reason: "no-attachment-id" });
  });

  await test("rejectionMessage maps known reasons to localized copy", () => {
    assert.equal(rejectionMessage("over-size-cap:26214400", "en"), "File too large (max 25 MB)");
    assert.equal(rejectionMessage("limit-file-size", "en"), "File too large (max 25 MB)");
    assert.equal(rejectionMessage("mime-not-allowed", "en"), "Unsupported file type");
    assert.equal(rejectionMessage("executable-or-macro", "en"), "Unsupported file type");
    assert.equal(rejectionMessage("unreadable-document", "en"), "File is empty or unreadable");
    assert.equal(rejectionMessage("empty-file", "en"), "File is empty or unreadable");
    // Unknown reasons stay visible so the user is never left guessing.
    assert.equal(rejectionMessage("weird-reason", "en"), "Upload failed (weird-reason)");
  });

  const pills: ComposerAttachment[] = [
    { id: "1", name: "a.pdf", size: 1, mime: "application/pdf", status: "ready", serverId: "clatt_a" },
    { id: "2", name: "b.pdf", size: 1, mime: "application/pdf", status: "failed", error: "x" },
    { id: "3", name: "c.pdf", size: 1, mime: "application/pdf", status: "uploading" },
  ];

  await test("readyAttachmentIds includes only ready pills with a server id", () => {
    assert.deepEqual(readyAttachmentIds(pills), ["clatt_a"]);
    assert.deepEqual(
      readyAttachmentIds([{ ...pills[0], serverId: undefined }]),
      [],
    );
  });

  await test("hasUploadInFlight blocks send while any pill uploads", () => {
    assert.equal(hasUploadInFlight(pills), true);
    assert.equal(hasUploadInFlight(pills.filter((p) => p.status !== "uploading")), false);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
};

void run();
