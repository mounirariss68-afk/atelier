/**
 * Cognirise Navy Statement export: ZIP structure, rendered parity, protected
 * direct download, no-cache headers, and export audit coverage.
 *
 * Run: pnpm --filter @workspace/api-server test:email-template-package
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "./scratch-db.js";
import { type AddressInfo } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

const TAG = `email_template_${Date.now()}`;

async function main() {
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierAuditEvents } = D as any;
  const { eq, inArray } = await import("drizzle-orm");
  const {
    COGNIRISE_EMAIL_TEMPLATE_FILENAME,
    NAVY_STATEMENT_EXAMPLE_OPTIONS,
  } = await import("../../src/lib/cognirise-email-template-package.js");
  const { renderCogniriseEmail } = await import("../../src/lib/cognirise-email-templates.js");
  const app = (await import("../../src/app.js")).default;

  const orgId = "aico";
  const founderId = `u_${TAG}_founder`;
  const hrId = `u_${TAG}_hr`;
  const consultantId = `u_${TAG}_consultant`;
  await db.insert(atelierUsers).values([
    {
      id: founderId, orgId, email: `${TAG}_founder@cognirise.example`,
      name: `Founder ${TAG}`, initials: "FT", role: "founding_partner",
      roleLabel: "Founding Partner", title: "Founding Partner",
    },
    {
      id: hrId, orgId, email: `${TAG}_hr@cognirise.example`,
      name: `HR ${TAG}`, initials: "HR", role: "hr", roleLabel: "HR", title: "People",
    },
    {
      id: consultantId, orgId, email: `${TAG}_consultant@cognirise.example`,
      name: `Consultant ${TAG}`, initials: "CT", role: "consultant",
      roleLabel: "Consultant", title: "Consultant",
    },
  ]);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/api/atelier/firm-profile/email-template.zip`;
  const download = async (persona?: string) => {
    const response = await fetch(url, {
      headers: persona ? { cookie: `atelier_persona=${persona}` } : {},
    });
    return {
      response,
      bytes: Buffer.from(await response.arrayBuffer()),
    };
  };

  try {
    const anonymous = await download();
    check("unauthenticated download is rejected", anonymous.response.status === 401, anonymous.response.status);

    const consultant = await download(consultantId);
    check("non-brand-admin download is rejected", consultant.response.status === 403, consultant.response.status);

    const founder = await download(founderId);
    check("founding partner receives ZIP", founder.response.status === 200, founder.response.status);
    check(
      "ZIP response uses the stable attachment filename",
      founder.response.headers.get("content-disposition") ===
        `attachment; filename="${COGNIRISE_EMAIL_TEMPLATE_FILENAME}"`,
      founder.response.headers.get("content-disposition"),
    );
    check(
      "ZIP response is private and non-cacheable",
      founder.response.headers.get("cache-control") === "private, no-store",
      founder.response.headers.get("cache-control"),
    );
    check(
      "ZIP response has the correct MIME type",
      founder.response.headers.get("content-type")?.startsWith("application/zip") === true,
      founder.response.headers.get("content-type"),
    );
    check("ZIP payload starts with a ZIP magic header", founder.bytes.subarray(0, 2).toString() === "PK", founder.bytes.subarray(0, 4));

    const archive = await JSZip.loadAsync(founder.bytes);
    const required = [
      "README.md",
      "cognirise-email-templates.ts",
      "email-assets/cognirise-logo.png",
      "examples/navy-statement-example.html",
      "examples/navy-statement-example.txt",
    ];
    check("ZIP contains every portable package entry", required.every((name) => archive.file(name)), Object.keys(archive.files));

    const [readme, renderer, logo, exampleHtml, exampleText] = await Promise.all([
      archive.file("README.md")!.async("string"),
      archive.file("cognirise-email-templates.ts")!.async("string"),
      archive.file("email-assets/cognirise-logo.png")!.async("nodebuffer"),
      archive.file("examples/navy-statement-example.html")!.async("string"),
      archive.file("examples/navy-statement-example.txt")!.async("string"),
    ]);
    const rendered = renderCogniriseEmail(NAVY_STATEMENT_EXAMPLE_OPTIONS);
    check("package includes a non-empty Cognirise logo asset", logo.length > 100 && logo.subarray(1, 4).toString("ascii") === "PNG", logo.subarray(0, 8));
    check(
      "README documents safe rich HTML boundary",
      /trusted boundary/i.test(readme) && /CID logo contract/i.test(readme),
      readme.slice(0, 1200),
    );
    check(
      "portable renderer preserves CID logo and supported options",
      renderer.includes('src="cid:${LOGO_CID}"') &&
        renderer.includes('const LOGO_CID = "cognirise-logo"') &&
        renderer.includes("bodyHtml?: string") &&
        renderer.includes("bodyText?: string") &&
        renderer.includes("cogniriseEscapeHtml"),
      renderer.slice(0, 1800),
    );
    check("packaged HTML is rendered by the canonical Navy Statement renderer", exampleHtml === rendered.html, {
      packageLength: exampleHtml.length, canonicalLength: rendered.html.length,
    });
    check("packaged plain text equals the canonical fallback", exampleText === rendered.text, { exampleText, canonical: rendered.text });
    check(
      "example keeps Navy Statement table, inline styling, fonts, gradient and CID logo",
      exampleHtml.includes('role="presentation"') &&
        exampleHtml.includes("background:#0A1230") &&
        exampleHtml.includes("'Comfortaa','Inter','Segoe UI'") &&
        exampleHtml.includes("linear-gradient(90deg,#5B7CFF") &&
        exampleHtml.includes('src="cid:cognirise-logo"'),
      exampleHtml.slice(0, 2000),
    );

    const escaped = renderCogniriseEmail({
      title: '<title & "quote">',
      greeting: "Hello <Alex>",
      paragraphs: ["One & two"],
      cta: { label: "Go <now>", url: "https://example.test/?x=<unsafe>" },
    });
    check(
      "canonical renderer still escapes title, greeting, paragraphs and CTA",
      escaped.html.includes("&lt;title &amp; &quot;quote&quot;&gt;") &&
        escaped.html.includes("Hello &lt;Alex&gt;") &&
        escaped.html.includes("One &amp; two") &&
        escaped.html.includes("Go &lt;now&gt;") &&
        escaped.html.includes("x=&lt;unsafe&gt;"),
      escaped.html,
    );

    const portableDir = await mkdtemp(join(tmpdir(), "cognirise-email-template-"));
    try {
      const modulePath = join(portableDir, "cognirise-email-templates.ts");
      const logoDir = join(portableDir, "email-assets");
      await mkdir(logoDir);
      await Promise.all([
        writeFile(modulePath, renderer, "utf8"),
        writeFile(join(logoDir, "cognirise-logo.png"), logo),
      ]);
      const portable = await import(`${pathToFileURL(modulePath).href}?probe=${Date.now()}`);
      const parityCases = [
        NAVY_STATEMENT_EXAMPLE_OPTIONS,
        {
          title: '<Escaped & "safe">',
          greeting: "Hello <Alex>",
          paragraphs: ["One & two"],
          cta: { label: "Go <now>", url: "https://example.test/?x=<unsafe>" },
        },
        {
          title: "Rich body",
          bodyHtml: '<div style="color:#0A1230;">Trusted markup</div>',
          bodyText: "Rich body\n\nTrusted markup\n\n—\nCustom footer",
          footerText: "Custom footer",
        },
      ];
      check(
        "portable TypeScript source renders exact canonical parity",
        parityCases.every((options) => {
          const portableRendered = portable.renderCogniriseEmail(options);
          const canonicalRendered = renderCogniriseEmail(options);
          return portableRendered.html === canonicalRendered.html &&
            portableRendered.text === canonicalRendered.text;
        }),
        "one or more representative option combinations diverged",
      );
      const portableBuilt = portable.buildCogniriseEmail({ title: "Portable probe" });
      check(
        "portable builder returns the exact CID attachment contract",
        portableBuilt.attachments.length === 1 &&
          portableBuilt.attachments[0].filename === "cognirise-logo.png" &&
          portableBuilt.attachments[0].content_id === "cognirise-logo" &&
          Buffer.from(portableBuilt.attachments[0].content, "base64").equals(logo),
        portableBuilt.attachments,
      );
    } finally {
      await rm(portableDir, { recursive: true, force: true });
    }

    const hr = await download(hrId);
    check("HR can also download the package", hr.response.status === 200, hr.response.status);
    const audits = await db.select().from(atelierAuditEvents).where(
      inArray(atelierAuditEvents.actorId, [founderId, hrId]),
    );
    check(
      "successful downloads are audited consistently",
      audits.filter(
        (event: any) =>
          event.action === "document.downloaded" &&
          event.payload?.kind === "cognirise_email_template_zip",
      ).length === 2,
      audits.map((event: any) => ({ action: event.action, payload: event.payload })),
    );
  } finally {
    await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.actorId, [founderId, hrId, consultantId]));
    await db.delete(atelierUsers).where(inArray(atelierUsers.id, [founderId, hrId, consultantId]));
    server.close();
    await pool?.end?.().catch(() => {});
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("PROBE CRASHED", err);
  process.exit(1);
});