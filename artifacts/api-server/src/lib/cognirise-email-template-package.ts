/**
 * Portable export of Cognirise's founder-selected "Navy Statement" email
 * template. The ZIP embeds the canonical production renderer source itself,
 * so the portable implementation cannot silently drift from outbound email.
 */
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import {
  getCogniriseEmailLogoBase64,
  renderCogniriseEmail,
  type CogniriseEmailOptions,
} from "./cognirise-email-templates.js";

export const COGNIRISE_EMAIL_TEMPLATE_FILENAME =
  "Cognirise_Navy_Statement_email_template.zip";

export const NAVY_STATEMENT_EXAMPLE_OPTIONS: CogniriseEmailOptions = {
  title: "Welcome to Cognirise",
  greeting: "Dear Alex,",
  paragraphs: [
    "We are pleased to share an important update from the Cognirise team.",
    "Your Atelier workspace is ready whenever you are.",
  ],
  bodyHtml:
    '<div style="margin:0 0 20px;padding:14px 16px;background:#F3F4F8;border:1px solid #E4E7F0;border-radius:8px;font-family:\'Inter\',\'Segoe UI\',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#3a4360;">Reply to this email if you need any support.</div>',
  cta: { label: "Open Atelier", url: "https://atelier.cognirise.example/" },
  footerText: "Cognirise — Atelier",
  bodyText: [
    "Welcome to Cognirise",
    "",
    "Dear Alex,",
    "",
    "We are pleased to share an important update from the Cognirise team.",
    "",
    "Your Atelier workspace is ready whenever you are.",
    "",
    "Reply to this email if you need any support.",
    "",
    "Open Atelier: https://atelier.cognirise.example/",
    "",
    "—",
    "Cognirise — Atelier",
  ].join("\n"),
};

let cachedRendererSource: string | null = null;
function canonicalRendererSource(): string {
  if (cachedRendererSource) return cachedRendererSource;
  // In tsx development this file sits beside the canonical source. In the
  // esbuild bundle, build.mjs copies that same source beside dist/index.mjs.
  const candidates = [
    new URL("./cognirise-email-templates.ts", import.meta.url),
    new URL("../src/lib/cognirise-email-templates.ts", import.meta.url),
  ];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      cachedRendererSource = readFileSync(candidate, "utf8");
      return cachedRendererSource;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Canonical Cognirise email renderer source not found: ${String(lastError)}`,
  );
}

const README = `# Cognirise Navy Statement email template

This package contains the exact TypeScript renderer used by Cognirise Atelier
for the founder-selected "Navy Statement" design.

## Contents

- \`cognirise-email-templates.ts\` — canonical renderer and public input types
- \`email-assets/cognirise-logo.png\` — CID image required by the header
- \`examples/navy-statement-example.html\` — rendered email-safe HTML
- \`examples/navy-statement-example.txt\` — matching plain-text fallback

Keep the \`email-assets\` folder beside the TypeScript module.

## Supported input

\`CogniriseEmailOptions\` accepts:

| Field | Purpose |
| --- | --- |
| \`title\` | Required white-card headline; HTML escaped. |
| \`greeting\` | Optional greeting; HTML escaped. |
| \`paragraphs\` | Optional plain-text paragraphs; each is HTML escaped. |
| \`bodyHtml\` | Optional trusted, pre-built inline-styled HTML after paragraphs. |
| \`cta\` | Optional \`{ label, url }\` gradient button; both values are escaped. |
| \`footerText\` | Optional footer; defaults to \`Cognirise — Atelier\`. |
| \`bodyText\` | Optional complete plain-text override for rich bodies. |

## Safe rich-HTML boundary

\`bodyHtml\` is intentionally a trusted boundary for server-owned markup such
as information boxes and lists. Escape every user-controlled value with
\`cogniriseEscapeHtml()\` before adding it. Never pass untrusted rich text
directly to \`bodyHtml\`. When rich content adds meaning that is absent from
\`paragraphs\`, provide a complete \`bodyText\` fallback as the example does.

## CID logo contract

\`buildCogniriseEmail(options)\` returns \`html\`, \`text\`, and an attachment
with filename \`cognirise-logo.png\`, content ID \`cognirise-logo\`, and base64
content. The HTML references \`cid:cognirise-logo\`. Append other attachments
after this returned attachment.

### Resend-compatible transports

\`\`\`ts
const built = buildCogniriseEmail(options);
await emailClient.send({
  from, to, subject, html: built.html, text: built.text,
  attachments: built.attachments.map((a) => ({
    filename: a.filename, content: a.content, content_id: a.content_id,
  })),
});
\`\`\`

### Nodemailer

\`\`\`ts
const built = buildCogniriseEmail(options);
await transporter.sendMail({
  from, to, subject, html: built.html, text: built.text,
  attachments: built.attachments.map((a) => ({
    filename: a.filename, content: Buffer.from(a.content, "base64"), cid: a.content_id,
  })),
});
\`\`\`

### Microsoft Graph

Map the returned attachment to a \`fileAttachment\`: use \`contentBytes\` for
the base64 content, \`contentId\` for \`content_id\`, and \`isInline: true\`.

The renderer intentionally keeps its 600px presentation tables and inline CSS
for Gmail and Outlook compatibility. Preserve that structure when integrating.
`;

export async function buildCogniriseEmailTemplatePackage(): Promise<Buffer> {
  const zip = new JSZip();
  const { html, text } = renderCogniriseEmail(NAVY_STATEMENT_EXAMPLE_OPTIONS);
  zip.file("README.md", README);
  zip.file("cognirise-email-templates.ts", canonicalRendererSource());
  zip.file(
    "email-assets/cognirise-logo.png",
    Buffer.from(getCogniriseEmailLogoBase64(), "base64"),
  );
  zip.file("examples/navy-statement-example.html", html);
  zip.file("examples/navy-statement-example.txt", text);
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}