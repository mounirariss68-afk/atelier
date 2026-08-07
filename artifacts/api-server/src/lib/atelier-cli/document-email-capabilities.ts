/**
 * document.email — email COMPANY documents from the Document Library
 * ("email our company registration certificate to Gokhan") through the
 * caller's own Outlook mailbox (Microsoft Graph, delegated).
 *
 * Mirrors the email_my_documents contract:
 *   - default mode creates an Outlook DRAFT for review; mode "send"
 *     sends immediately (typed-name confirm, outbound email channel);
 *   - recipients accept raw emails OR people names — names resolve
 *     against the org roster + CRM contacts (single match → confirm
 *     card shows "Name <email>"; multiple → pick-one options card);
 *   - documents resolve by fuzzy title/kind/file-name match over the
 *     library docs the caller is allowed to SEE (canSeeDocument — the
 *     same predicate as the Documents page); multiple doc matches
 *     return a pick-one options card;
 *   - attachments over ~3 MB are refused honestly.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierDocuments,
  atelierDocumentVersions,
  atelierAuditEvents,
  atelierMsConnections,
} from "@workspace/db";
import {
  CATALOG_SCHEMA_VERSION,
  defineCapability,
} from "./capability-catalog.js";
import {
  MsAuthError,
  MsGraphError,
  createDraftMessage,
  hasMailDraftScope,
  hasMailSendScope,
  sendMailMessage,
  type MsMailAttachment,
} from "../msGraph.js";
import { loadDocBytes } from "../atelier-documents.js";
import { canSeeDocument } from "../../routes/atelier/documentRoutes.js";
import { accessibleEngagementIds } from "../../routes/atelier/engagementRoutes";
import { resolveEmailRecipients, recipientLabel } from "./email-recipient-resolver.js";
import { resolveAccount } from "./resolvers/index.js";
import { rankNearestNames } from "./nearest-suggestions.js";
import type { ToolResult } from "./index.js";

const MAIL_ATTACH_MAX_BYTES = 3 * 1024 * 1024;

function rid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
}

type DocRow = typeof atelierDocuments.$inferSelect;
type VersionRow = typeof atelierDocumentVersions.$inferSelect;

/** Fuzzy title/kind/file-name match, with a specificity pass so an
 *  exact-title query never fans out to same-kind siblings. Exported for
 *  the probe. */
export function matchLibraryDocuments(
  docs: Array<{ doc: DocRow; version: VersionRow | null }>,
  term: string,
): Array<{ doc: DocRow; version: VersionRow | null }> {
  const q = norm(term);
  if (!q) return [];
  const qTokens = q.split(" ").filter((t) => t.length > 2);
  const broad = docs.filter(({ doc, version }) => {
    const title = norm(doc.title);
    const kind = norm(doc.docKind ?? "");
    const fileName = norm(version?.fileName ?? "");
    if (title.includes(q) || q.includes(title)) return true;
    if (kind && (kind === q || q.includes(kind) || kind.includes(q))) return true;
    if (fileName && fileName.includes(q)) return true;
    // Token overlap: "company registration certificate in Dubai" should
    // hit "Commercial Registration Certificate" — require most query
    // tokens to appear across title+kind+filename.
    if (qTokens.length >= 2) {
      const hay = `${title} ${kind} ${fileName}`;
      const hits = qTokens.filter((t) => hay.includes(t)).length;
      return hits >= Math.ceil(qTokens.length / 2) && hits >= 2;
    }
    return false;
  });
  if (broad.length <= 1) return broad;
  const exact = broad.filter(({ doc }) => norm(doc.title) === q);
  if (exact.length > 0) return exact;
  const titleHit = broad.filter(({ doc }) => {
    const t = norm(doc.title);
    return t.includes(q) || q.includes(t);
  });
  if (titleHit.length > 0 && titleHit.length < broad.length) return titleHit;
  return broad;
}

defineCapability({
  id: "document.email",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "meta",
  toolName: "email_company_documents",
  description:
    "Email one or more COMPANY documents from the Document Library (trade license, registration certificate, MOA, proposals, deliverables…) through the signed-in user's connected Outlook mailbox. Default creates an Outlook DRAFT for review; mode 'send' sends immediately. Recipients accept email addresses or people names (roster colleagues / CRM contacts are looked up automatically). Only documents the caller can already see in the library.",
  slashAliases: { en: ["/email-company-doc"] },
  representativePrompts: {
    en: [
      "Email our company registration certificate to Gokhan",
      "Send the trade license to jane@client.com",
      "Email the Dubai commercial register document to our lawyer",
    ],
    fr: ["Envoyer notre licence commerciale par e-mail"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Email our company registration certificate to Gokhan"],
    fr: ["Envoyer notre licence commerciale par e-mail"],
  },
  inputSchema: {
    type: "object",
    properties: {
      documentIds: {
        type: "array",
        items: { type: "string" },
        description: "Exact document ids from list_documents (preferred)",
      },
      query: {
        type: "string",
        description:
          "Free-text document match ('registration certificate', 'trade license') when ids are unknown",
      },
      accountName: {
        type: "string",
        description:
          "Account/client name when the request scopes the document to an account, e.g. 'email the report for U Mobile to Sarah' → accountName 'U Mobile'. Also prefers that account's contacts when resolving recipient names.",
      },
      to: {
        type: "array",
        items: { type: "string" },
        description:
          "Recipients — email addresses OR people names ('Gokhan', 'Jane Smith'). Names are looked up in the org roster and CRM contacts automatically; never ask the user for an email address when they gave a name.",
      },
      mode: {
        type: "string",
        enum: ["draft", "send"],
        description: "draft (default) creates an Outlook draft for review; send emails immediately",
      },
      subject: { type: "string" },
      message: { type: "string", description: "Plain-text email body" },
      confirm: { type: "boolean" },
    },
    required: ["to"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: false,
  outboundChannel: "email",
  async run(input, ctx) {
    // ---- recipients ---------------------------------------------------
    const rawTo = Array.isArray(input.to) ? input.to : [];
    const toEntries = [...new Set(rawTo.map((r) => String(r).trim()).filter(Boolean))];
    if (toEntries.length === 0 || toEntries.length > 10) {
      return {
        ok: false,
        errorCode: "invalid_recipients",
        errorMessage: "Provide between 1 and 10 recipients (email addresses or people names).",
      };
    }
    // ---- account context (Task #783) ------------------------------------
    // "email the report for U Mobile to Sarah" — resolve the account
    // first so it can scope BOTH the document match and the recipient
    // lookup.
    let accountId: string | null = null;
    let accountLabel: string | null = null;
    const accountName = typeof input.accountName === "string" ? input.accountName.trim() : "";
    if (accountName) {
      const acc = await resolveAccount(accountName, ctx.persona);
      if (acc.kind === "choices") {
        return {
          ok: true,
          data: { prompt: acc.prompt, options: acc.options, navigateTo: null },
          disambiguation: { kind: "account", options: acc.options },
        };
      }
      if (acc.kind === "none") {
        return {
          ok: false,
          errorCode: "not_found",
          errorMessage: `I couldn't find an account matching "${accountName}" in the CRM. Check the name, or leave the account off and I'll search the whole document library.`,
        };
      }
      accountId = acc.id;
      accountLabel = acc.label;
    }

    const resolution = await resolveEmailRecipients(toEntries, ctx.persona, {
      preferAccountId: accountId ?? undefined,
    });
    if (resolution.kind === "result") return resolution.result as ToolResult;
    const resolved = resolution.recipients;
    const recipients = resolved.map((r) => r.email);
    const recipientLabels = resolved.map(recipientLabel);
    if (recipients.length === 0) {
      return {
        ok: false,
        errorCode: "invalid_recipients",
        errorMessage:
          "I couldn't turn those recipients into email addresses — give me a person's name from the roster or CRM, or a full email address.",
      };
    }
    const mode =
      input.mode === "send" ? "send" : input.mode === "draft" || input.mode === undefined ? "draft" : null;
    if (!mode) {
      return { ok: false, errorCode: "invalid_mode", errorMessage: "mode must be 'draft' or 'send'." };
    }

    // ---- visible library documents -------------------------------------
    const [meRow] = await db
      .select()
      .from(atelierUsers)
      .where(and(eq(atelierUsers.id, ctx.persona.id), eq(atelierUsers.orgId, ctx.persona.orgId)))
      .limit(1);
    if (!meRow) {
      return { ok: false, errorCode: "not_found", errorMessage: "Your login could not be resolved to a user record." };
    }
    const access = await accessibleEngagementIds(meRow);
    const allDocs = await db
      .select()
      .from(atelierDocuments)
      .where(
        and(
          eq(atelierDocuments.orgId, ctx.persona.orgId),
          eq(atelierDocuments.status, "active"),
          isNull(atelierDocuments.deletedAt),
        ),
      )
      .orderBy(desc(atelierDocuments.updatedAt))
      .limit(500);
    const visible: Array<{ doc: DocRow; version: VersionRow | null }> = [];
    for (const doc of allDocs) {
      if (!(await canSeeDocument(meRow, access, doc))) continue;
      let version: VersionRow | null = null;
      if (doc.currentVersionId) {
        const [v] = await db
          .select()
          .from(atelierDocumentVersions)
          .where(eq(atelierDocumentVersions.id, doc.currentVersionId))
          .limit(1);
        version = v ?? null;
      }
      visible.push({ doc, version });
    }

    let selected: Array<{ doc: DocRow; version: VersionRow }> = [];
    const ids = Array.isArray(input.documentIds)
      ? [...new Set(input.documentIds.map((v) => String(v)).filter(Boolean))]
      : [];
    const requireVersion = (
      pair: { doc: DocRow; version: VersionRow | null },
    ): ToolResult | { doc: DocRow; version: VersionRow } => {
      if (!pair.version || !pair.version.blobRef) {
        return {
          ok: false,
          errorCode: "file_missing",
          errorMessage: `"${pair.doc.title}" has no stored file that can be attached.`,
        };
      }
      return { doc: pair.doc, version: pair.version };
    };
    if (ids.length > 0) {
      const byId = new Map(visible.map((p) => [p.doc.id, p]));
      for (const id of ids) {
        const pair = byId.get(id);
        if (!pair) {
          return {
            ok: false,
            errorCode: "doc_not_found",
            errorMessage: `Document ${id} was not found in the library (or you don't have access to it). Ask me to list the documents and pick from there.`,
          };
        }
        const r = requireVersion(pair);
        if ("ok" in r) return r;
        selected.push(r);
      }
    } else {
      const query = String(input.query ?? "").trim();
      if (!query) {
        return {
          ok: false,
          errorCode: "doc_not_found",
          errorMessage: "Which company document should I email? Give me a title, e.g. 'registration certificate'.",
        };
      }
      // Task #783 — account scope: match within the account's documents
      // first; on an in-scope miss fall back to the whole visible
      // library but say so honestly.
      const scoped = accountId ? visible.filter((p) => p.doc.accountId === accountId) : visible;
      let matches = matchLibraryDocuments(scoped, query);
      let scopeNote: string | null = null;
      if (matches.length === 0 && accountId) {
        matches = matchLibraryDocuments(visible, query);
        if (matches.length > 0) {
          scopeNote = `No document matching "${query}" is linked to ${accountLabel}, but the library has these elsewhere — pick one if it's what you meant.`;
          const options = matches.slice(0, 6).map(({ doc, version }) => ({
            id: doc.id,
            label: doc.title,
            secondary: [doc.docKind, version?.fileName].filter(Boolean).join(" — "),
          }));
          return {
            ok: true,
            data: { prompt: scopeNote, options, navigateTo: null },
            disambiguation: { kind: "document", options },
          };
        }
      }
      if (matches.length === 0) {
        // Friendly miss: suggest the closest titles the caller can see.
        const where = accountId ? `linked to ${accountLabel}` : "in the library";
        const nearest = rankNearestNames(
          query,
          scoped.map(({ doc, version }) => ({
            id: doc.id,
            label: doc.title,
            secondary: [doc.docKind, version?.fileName].filter(Boolean).join(" — "),
          })),
        );
        if (nearest.length > 0) {
          return {
            ok: true,
            data: {
              prompt: `I couldn't find a document matching "${query}" ${where} — did you mean one of these?`,
              options: nearest,
              navigateTo: null,
            },
            disambiguation: { kind: "document", options: nearest },
          };
        }
        return {
          ok: false,
          errorCode: "doc_not_found",
          errorMessage: `I couldn't find a company document matching "${query}" ${where}. Ask me to list the documents to see what's available, or upload it to the Document Library first.`,
        };
      }
      if (matches.length > 1) {
        const options = matches.slice(0, 6).map(({ doc, version }) => ({
          id: doc.id,
          label: doc.title,
          secondary: [doc.docKind, version?.fileName].filter(Boolean).join(" — "),
        }));
        return {
          ok: true,
          data: {
            prompt: `I found ${matches.length} documents matching "${query}" — which one should I email? Re-run with the exact documentIds.`,
            options,
            navigateTo: null,
          },
          disambiguation: { kind: "document", options },
        };
      }
      const r = requireVersion(matches[0]!);
      if ("ok" in r) return r;
      selected = [r];
    }
    if (selected.length === 0) {
      return {
        ok: false,
        errorCode: "doc_not_found",
        errorMessage:
          "I couldn't work out which document to email — give me its title (e.g. 'trade license') or ask me to list the documents.",
      };
    }

    // ---- size guard -----------------------------------------------------
    for (const { doc, version } of selected) {
      if (version.sizeBytes > MAIL_ATTACH_MAX_BYTES) {
        return {
          ok: false,
          errorCode: "attachment_too_large",
          errorMessage: `"${doc.title}" is ${(version.sizeBytes / (1024 * 1024)).toFixed(1)} MB — email attachments from chat are limited to 3 MB per file. Share it manually instead.`,
        };
      }
    }

    // ---- Microsoft connection must exist BEFORE the confirm card --------
    const [conn] = await db
      .select()
      .from(atelierMsConnections)
      .where(eq(atelierMsConnections.userId, ctx.persona.id))
      .limit(1);
    if (!conn) {
      return {
        ok: false,
        errorCode: "ms_not_connected",
        errorMessage:
          "Your Microsoft 365 account isn't connected, so I can't use your Outlook mailbox. Connect it from Me → Settings → Microsoft 365, then try again.",
      };
    }

    const docSummary = selected.map(({ doc }) => `"${doc.title}"`).join(", ");

    // ---- two-phase confirm ----------------------------------------------
    if (input.confirm !== true) {
      const diff: Record<string, unknown> =
        mode === "send"
          ? {
              send: { channel: "email", recipients: recipientLabels, documents: selected.map(({ doc }) => doc.title) },
              irreversible: true,
              typedNameRequired: recipients.join(", "),
              outboundChannel: "email",
            }
          : {
              create: {
                target: "outlook_draft",
                recipients: recipientLabels,
                documents: selected.map(({ doc }) => doc.title),
              },
            };
      return {
        ok: true,
        data: {
          preview: {
            mode,
            recipients,
            recipientLabels,
            documents: selected.map(({ doc, version }) => ({
              id: doc.id,
              title: doc.title,
              docKind: doc.docKind ?? null,
              fileName: version.fileName,
              sizeBytes: version.sizeBytes,
            })),
          },
        },
        confirmation: {
          summary:
            mode === "send"
              ? `Send ${docSummary} to ${recipientLabels.join(", ")} from your Outlook mailbox now?`
              : `Create an Outlook draft to ${recipientLabels.join(", ")} with ${docSummary} attached, for you to review and send?`,
          diff,
          pending: {
            tool: "email_company_documents",
            input: {
              documentIds: selected.map(({ doc }) => doc.id),
              to: recipients,
              mode,
              ...(input.subject !== undefined ? { subject: String(input.subject) } : {}),
              ...(input.message !== undefined ? { message: String(input.message) } : {}),
              confirm: true,
            },
          },
        },
      };
    }

    // ---- commit: token + scope, load bytes, call Graph -------------------
    const RECONNECT: ToolResult = {
      ok: false,
      errorCode: "ms_reconnect_required",
      errorMessage:
        "Your Microsoft 365 connection doesn't have email permission yet. Disconnect and reconnect Microsoft 365 from Me → Settings, then try again.",
    };
    let accessToken: string;
    let scopes: string[];
    try {
      const { freshAccessToken } = await import("../msScheduling.js");
      const fresh = await freshAccessToken(conn);
      accessToken = fresh.accessToken;
      scopes = fresh.scopes;
    } catch (err) {
      if (err instanceof MsAuthError || err instanceof MsGraphError) return RECONNECT;
      throw err;
    }
    if (mode === "send" ? !hasMailSendScope(scopes) : !hasMailDraftScope(scopes)) {
      return RECONNECT;
    }

    const attachments: MsMailAttachment[] = [];
    for (const { doc, version } of selected) {
      const bytes = await loadDocBytes(version.blobRef);
      if (!bytes) {
        return {
          ok: false,
          errorCode: "file_missing",
          errorMessage: `The stored file for "${doc.title}" could not be loaded.`,
        };
      }
      if (bytes.byteLength > MAIL_ATTACH_MAX_BYTES) {
        return {
          ok: false,
          errorCode: "attachment_too_large",
          errorMessage: `"${version.fileName}" exceeds the 3 MB attachment limit.`,
        };
      }
      attachments.push({
        name: version.fileName || `${doc.title}.pdf`,
        contentType: version.mime || "application/octet-stream",
        contentBytes: bytes,
      });
    }

    const mailSubject =
      typeof input.subject === "string" && input.subject.trim()
        ? input.subject.trim().slice(0, 200)
        : `Documents from ${ctx.persona.name}`;
    const bodyText =
      typeof input.message === "string" && input.message.trim()
        ? input.message.trim().slice(0, 5000)
        : `Please find attached: ${selected.map(({ doc }) => doc.title).join(", ")}.\n\nSent from The Atelier on behalf of ${ctx.persona.name}.`;
    const toWire = recipients.map((email) => ({ email }));

    let draftLink: string | null = null;
    let draftId: string | null = null;
    try {
      if (mode === "send") {
        await sendMailMessage(accessToken, { subject: mailSubject, bodyText, to: toWire, attachments });
      } else {
        const draft = await createDraftMessage(accessToken, { subject: mailSubject, bodyText, to: toWire, attachments });
        draftLink = draft.webLink ?? null;
        draftId = draft.id ?? null;
      }
    } catch (err) {
      if (err instanceof MsGraphError) {
        if (err.status === 401 || err.status === 403) return RECONNECT;
        if (err.status === 413) {
          return {
            ok: false,
            errorCode: "attachment_too_large",
            errorMessage: "Outlook rejected the message because the attachments are too large.",
          };
        }
        return {
          ok: false,
          errorCode: "ms_graph_error",
          errorMessage: `Outlook returned an error (${err.status}) — the ${mode === "send" ? "email was not sent" : "draft was not created"}. Try again shortly.`,
        };
      }
      if (err instanceof MsAuthError) return RECONNECT;
      throw err;
    }

    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "atelier_document",
      entityId: selected[0]!.doc.id,
      actorType: "human",
      actorId: ctx.persona.id,
      actorLabel: ctx.persona.name,
      action: "document.emailed",
      payload: {
        mode,
        documentIds: selected.map(({ doc }) => doc.id),
        recipients,
        ...(draftId ? { draftId } : {}),
        via: "chat",
      },
      payloadSummary: `${ctx.persona.name} ${mode === "send" ? "emailed" : "drafted an Outlook email with"} ${selected
        .map(({ doc }) => doc.title)
        .join(", ")} to ${recipients.join(", ")}`,
    });

    if (mode === "draft") {
      return {
        ok: true,
        data: {
          mode: "draft",
          label: "Outlook draft created — review and send it from Outlook",
          documents: selected.map(({ doc }) => doc.title).join(", "),
          recipients: recipientLabels.join(", "),
          outlookDraftLink: draftLink,
          href: draftLink ?? "/documents",
          navigateTo: null,
        },
      };
    }
    return {
      ok: true,
      data: {
        mode: "sent",
        label: `Email sent to ${recipientLabels.join(", ")}`,
        documents: selected.map(({ doc }) => doc.title).join(", "),
        recipients: recipientLabels.join(", "),
        navigateTo: null,
      },
    };
  },
});

export const DOCUMENT_EMAIL_CAPABILITIES_LOADED = true;
