/**
 * The Cognirise-branded email template (founder-selected "Navy Statement"
 * design): dark navy header band with the white-wordmark logo, gradient
 * hairline rule, white body card, gradient CTA button, muted footer.
 *
 * Table-based, inline-styled HTML (Gmail/Outlook-safe) with a plain-text
 * fallback. The logo is an inline `cid:` attachment — email clients cannot
 * read app-bundled assets — so senders should use `buildCogniriseEmail`,
 * which returns the html, text AND the required logo attachment, and merge
 * any of their own attachments after it.
 */
import { readFileSync } from "node:fs";

export interface CogniriseEmailOptions {
  /** Email headline shown in the white card. */
  title: string;
  /** Optional greeting line, e.g. "Dear Mounir,". Escaped. */
  greeting?: string;
  /** Body paragraphs (plain text; escaped). Rendered before `bodyHtml`. */
  paragraphs?: string[];
  /**
   * Trusted, pre-built inline-styled HTML for richer bodies (info boxes,
   * lists…). The caller is responsible for escaping user content in it.
   */
  bodyHtml?: string;
  /** Optional call-to-action button. */
  cta?: { label: string; url: string };
  /** Footer line. Defaults to "Cognirise — Atelier". */
  footerText?: string;
  /**
   * Plain-text body override. Required for a faithful fallback when
   * `bodyHtml` carries content not present in `paragraphs`.
   */
  bodyText?: string;
}

const NAVY = "#0A1230";
const MAGENTA = "#C45BB8";
const GRAD = "linear-gradient(90deg,#5B7CFF 0%,#8A5BD6 35%,#C45BB8 65%,#FF7B5A 100%)";
// Task #1280 — brand pairing (matches the web app): Inter body, Comfortaa
// headings. Email clients rarely have either installed, so both stacks
// carry system fallbacks.
const SANS = "'Inter','Segoe UI',Helvetica,Arial,sans-serif";
const DISPLAY = "'Comfortaa','Inter','Segoe UI',Helvetica,Arial,sans-serif";

export const cogniriseEscapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const esc = cogniriseEscapeHtml;

const LOGO_CID = "cognirise-logo";

let cachedLogoB64: string | null = null;
function logoBase64(): string {
  if (!cachedLogoB64) {
    // Path differs by runtime: from src/lib (tsx dev) the assets are a
    // sibling directory; from the esbuild bundle (dist/index.mjs) they are
    // reached via ../src/lib. Try both; fail loudly if neither resolves.
    const candidates = [
      new URL("./email-assets/cognirise-logo.png", import.meta.url),
      new URL("../src/lib/email-assets/cognirise-logo.png", import.meta.url),
    ];
    let lastErr: unknown;
    for (const url of candidates) {
      try {
        cachedLogoB64 = readFileSync(url).toString("base64");
        return cachedLogoB64;
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(`Cognirise email logo asset not found: ${String(lastErr)}`);
  }
  return cachedLogoB64;
}

export function renderCogniriseEmail(o: CogniriseEmailOptions): {
  html: string;
  text: string;
} {
  const footer = o.footerText ?? "Cognirise — Atelier";
  const paras = (o.paragraphs ?? [])
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:1.65;color:#3a4360;">${esc(p)}</p>`,
    )
    .join("\n");
  const greeting = o.greeting
    ? `<p style="margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:1.65;color:#1c2440;">${esc(o.greeting)}</p>`
    : "";
  const cta = o.cta
    ? `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;"><tr>
        <td bgcolor="${MAGENTA}" style="border-radius:6px;background:${GRAD};">
          <a href="${esc(o.cta.url)}" target="_blank" style="display:inline-block;padding:13px 30px;font-family:${SANS};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${esc(o.cta.label)}</a>
        </td>
      </tr></table>`
    : "";
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cognirise</title></head>
<body style="margin:0;padding:0;background:#EDEFF5;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(o.title)}</div>
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#EDEFF5" style="background:#EDEFF5;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;">
        <tr><td bgcolor="${NAVY}" style="background:${NAVY};border-radius:10px 10px 0 0;padding:28px 36px;">
          <img src="cid:${LOGO_CID}" width="180" alt="Cognirise" style="display:block;border:0;width:180px;height:auto;">
        </td></tr>
        <tr><td height="3" bgcolor="${MAGENTA}" style="height:3px;line-height:3px;font-size:0;background:${GRAD};">&nbsp;</td></tr>
        <tr><td bgcolor="#ffffff" style="background:#ffffff;border-radius:0 0 10px 10px;padding:36px;">
          <h1 style="margin:0 0 20px;font-family:${DISPLAY};font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;color:${NAVY};">${esc(o.title)}</h1>
          ${greeting}
          ${paras}
          ${o.bodyHtml ?? ""}
          ${cta}
        </td></tr>
        <tr><td align="center" style="padding:20px 12px 0;">
          <p style="margin:0;font-family:${SANS};font-size:12px;color:#8a93ad;">${esc(footer)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  const text =
    o.bodyText ??
    [
      o.title,
      "",
      ...(o.greeting ? [o.greeting, ""] : []),
      ...(o.paragraphs ?? []).flatMap((p) => [p, ""]),
      ...(o.cta ? [`${o.cta.label}: ${o.cta.url}`, ""] : []),
      "—",
      footer,
    ].join("\n");
  return { html, text };
}

/**
 * Render the branded email AND the inline logo attachment it requires.
 * Callers with their own attachments (PDFs…) should append them to
 * `attachments`.
 */
export function buildCogniriseEmail(o: CogniriseEmailOptions): {
  html: string;
  text: string;
  attachments: { filename: string; content: string; content_id: string }[];
} {
  const { html, text } = renderCogniriseEmail(o);
  return {
    html,
    text,
    attachments: [
      { filename: "cognirise-logo.png", content: logoBase64(), content_id: LOGO_CID },
    ],
  };
}
