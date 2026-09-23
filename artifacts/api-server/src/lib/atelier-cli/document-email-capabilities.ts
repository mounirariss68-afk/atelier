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
import { and, eq } from "drizzle-orm";
import {
  db,
  atelierDocuments,
  atelierDocumentVersions,
  atelierAuditEvents,
  atelierMsConnections,
} from "@workspace/db";
import {
  CATALOG_SCHEMA_VERSION,
  defineCapability,
  findByToolName,
} from "./capability-catalog.js";
import {
  splitDocQueryTerms,
  matchLibraryDocuments as sharedMatchLibraryDocuments,
  matchOwnDocuments,
  loadOwnEmailableDocs,
  loadVisibleLibraryPairs,
  resolveTermsUnique,
  handoffEmailInput,
  type OwnDocRow,
} from "./document-email-shared.js";
import { hasPersonalDocCue, hasCompanyDocCue } from "./capability-retriever.js";
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
import { resolveEmailRecipients, recipientLabel } from "./email-recipient-resolver.js";
import { resolveAccount } from "./resolvers/index.js";
import { rankNearestNames } from "./nearest-suggestions.js";
import type { ToolResult } from "./index.js";
import { createDurableDocumentEmailPreview } from "../assistant/durable-document-email.js";

const MAIL_ATTACH_MAX_BYTES = 3 * 1024 * 1024;

function rid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

type DocRow = typeof atelierDocuments.$inferSelect;
type VersionRow = typeof atelierDocumentVersions.$inferSelect;

/** Fuzzy title/kind/file-name match — moved to document-email-shared
 *  for Task #846; re-exported here so the existing probe import keeps
 *  working. */
export const matchLibraryDocuments = sharedMatchLibraryDocuments;

/** Option-card wire shape for one of the caller's OWN personal docs
 *  (used when a company-tool query turns out to target the personal
 *  domain and the match is ambiguous). */
function ownDocOptionWire(d: OwnDocRow) {
  return {
    id: d.id,
    label: d.title || d.kind,
    secondary: [d.kind, d.fileName, "personal document"].filter(Boolean).join(" — "),
  };
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

    // ---- visible library documents (ACL-filtered in the shared loader) --
    const visibleOrNull = await loadVisibleLibraryPairs(ctx);
    if (!visibleOrNull) {
      return { ok: false, errorCode: "not_found", errorMessage: "Your login could not be resolved to a user record." };
    }
    const visible = visibleOrNull;

    // ---- Task #846: cross-domain handoff to the PERSONAL doc flow -------
    // A request that reaches the company tool may really target the
    // caller's own documents ("my saudi visa and emirates id"). When the
    // caller's OWN docs resolve the whole query unambiguously, hand off
    // to email_my_documents (strictly self-scoped) instead of dead-ending
    // with "upload it to the Document Library".
    const tryPersonalHandoff = async (
      terms: string[],
    ): Promise<ToolResult | null> => {
      const own = await loadOwnEmailableDocs(ctx);
      if (!own || own.length === 0) return null;
      const res = resolveTermsUnique(terms, (t) => matchOwnDocuments(own, t), (d) => d.id);
      if (res.kind === "all") {
        const entry = findByToolName("email_my_documents");
        if (!entry) return null;
        const r = (await entry.run(
          handoffEmailInput(input, res.hits.map((d) => d.id)),
          ctx,
        )) as ToolResult;
        if (r && r.ok && (r as { confirmation?: { summary?: string } }).confirmation) {
          const conf = (r as { confirmation: { summary?: string } }).confirmation;
          conf.summary = `These matched your PERSONAL documents (Me → Documents), not the company library. ${conf.summary ?? ""}`.trim();
        }
        return r;
      }
      if (res.kind === "ambiguous") {
        const options = res.matches.slice(0, 6).map(ownDocOptionWire);
        return {
          ok: true,
          data: {
            prompt: `"${res.term}" matched several of YOUR personal documents (not company library files) — which one should I email? Re-run email_my_documents with the exact documentIds.`,
            options,
            navigateTo: null,
          },
          disambiguation: { kind: "document", options },
        };
      }
      return null;
    };

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
      // Task #846 — ids that aren't library docs may be the caller's OWN
      // personal-document ids (e.g. picked from a cross-domain options
      // card). When ALL ids resolve in the personal domain, hand off.
      if (ids.some((id) => !byId.has(id))) {
        const own = await loadOwnEmailableDocs(ctx);
        const ownIds = new Set((own ?? []).map((d) => d.id));
        if (ids.every((id) => ownIds.has(id))) {
          const entry = findByToolName("email_my_documents");
          if (entry) return (await entry.run(handoffEmailInput(input, ids), ctx)) as ToolResult;
        }
      }
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
      // Task #846 — multi-document queries split exactly like the
      // personal tool ("X and Y", commas, "+", Arabic و); each term is
      // matched independently and deduped.
      const terms = splitDocQueryTerms(query);
      // Deterministic ownership cue: "my/personal" (without a company
      // cue) means the caller almost certainly wants their OWN docs —
      // probe the personal domain FIRST.
      if (hasPersonalDocCue(query) && !hasCompanyDocCue(query)) {
        const handoff = await tryPersonalHandoff(terms);
        if (handoff) return handoff;
      }
      // Task #783 — account scope: match within the account's documents
      // first; on an in-scope miss fall back to the whole visible
      // library but say so honestly.
      const scoped = accountId ? visible.filter((p) => p.doc.accountId === accountId) : visible;
      const seenIds = new Set<string>();
      for (const term of terms) {
        let matches = matchLibraryDocuments(scoped, term);
        if (matches.length === 0 && accountId) {
          matches = matchLibraryDocuments(visible, term);
          if (matches.length > 0) {
            const options = matches.slice(0, 6).map(({ doc, version }) => ({
              id: doc.id,
              label: doc.title,
              secondary: [doc.docKind, version?.fileName].filter(Boolean).join(" — "),
            }));
            return {
              ok: true,
              data: {
                prompt: `No document matching "${term}" is linked to ${accountLabel}, but the library has these elsewhere — pick one if it's what you meant.`,
                options,
                navigateTo: null,
              },
              disambiguation: { kind: "document", options },
            };
          }
        }
        if (matches.length === 0) {
          // Task #846 — before dead-ending, probe the caller's OWN
          // personal documents with the full query. On an unambiguous
          // full hit the request is handed off to email_my_documents.
          const handoff = await tryPersonalHandoff(terms);
          if (handoff) return handoff;
          // Honest dual-domain miss: name BOTH places checked and list
          // the nearest matches from each the caller can access.
          const where = accountId ? `linked to ${accountLabel}` : "in the Document Library";
          const own = await loadOwnEmailableDocs(ctx);
          const nearest = rankNearestNames(
            term,
            scoped.map(({ doc, version }) => ({
              id: doc.id,
              label: doc.title,
              secondary: [doc.docKind, version?.fileName].filter(Boolean).join(" — "),
            })),
          );
          const nearestOwn = own
            ? rankNearestNames(
                term,
                own.map((d) => ({
                  id: d.id,
                  label: d.title || d.kind,
                  secondary: [d.kind, "personal document"].filter(Boolean).join(" — "),
                })),
              )
            : [];
          const combined = [...nearest, ...nearestOwn].slice(0, 6);
          if (combined.length > 0) {
            const checkedNote = own
              ? `I checked both the company Document Library and your personal documents — nothing matches "${term}" exactly. Did you mean one of these?`
              : `I couldn't find a document matching "${term}" ${where} — did you mean one of these?`;
            return {
              ok: true,
              data: { prompt: checkedNote, options: combined, navigateTo: null },
              disambiguation: { kind: "document", options: combined },
            };
          }
          return {
            ok: false,
            errorCode: "doc_not_found",
            errorMessage: own
              ? `I couldn't find a document matching "${term}" — I checked both the company Document Library and your personal documents (Me → Documents). Ask me to list the documents in either place to see what's available.`
              : `I couldn't find a company document matching "${term}" ${where}. Ask me to list the documents to see what's available, or upload it to the Document Library first.`,
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
              prompt: `I found ${matches.length} documents matching "${term}" — which one should I email? Re-run with the exact documentIds.`,
              options,
              navigateTo: null,
            },
            disambiguation: { kind: "document", options },
          };
        }
        const r = requireVersion(matches[0]!);
        if ("ok" in r) return r;
        if (!seenIds.has(r.doc.id)) {
          seenIds.add(r.doc.id);
          selected.push(r);
        }
      }
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
      let durable: { actionId: string; stateVersion: number };
      try {
        durable = await createDurableDocumentEmailPreview({
          persona: ctx.persona,
          conversationId: ctx.sessionId,
          turnId: ctx.turnId,
          step: ctx.stepIdx,
          input: {
            documentIds: selected.map(({ doc }) => doc.id),
            versionIds: selected.map(({ version }) => version.id),
            to: recipients,
            mode,
            ...(input.subject !== undefined ? { subject: String(input.subject) } : {}),
            ...(input.message !== undefined ? { message: String(input.message) } : {}),
          },
          selected,
          recipientLabels,
        });
      } catch (error) {
        return {
          ok: false,
          errorCode: "durable_execution_unavailable",
          errorMessage: "This email action cannot be prepared safely right now. No Outlook request was made.",
        };
      }
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
              __durableActionId: durable.actionId,
              __durableStateVersion: durable.stateVersion,
              confirm: true,
            },
          },
          durableAction: durable,
        },
      };
    }

    // ---- commit: token + scope, load bytes, call Graph -------------------
    // Company-document email is now durable-only. The legacy direct Graph
    // path is intentionally fail-closed so a confirmation cannot bypass the
    // action claim, source revalidation, outbox record, or unknown outcome.
    if (typeof input.__durableActionId !== "string") {
      return {
        ok: false,
        errorCode: "durable_execution_required",
        errorMessage: "This email action must be previewed again before it can execute.",
      };
    }
    const { confirmAndExecuteDurableDocumentEmail } = await import("../assistant/durable-document-email.js");
    const durableOutcome = await confirmAndExecuteDurableDocumentEmail({
      actionId: input.__durableActionId,
      orgId: ctx.persona.orgId,
      requesterId: ctx.persona.id,
      persona: ctx.persona,
      expectedStateVersion:
        typeof input.__durableStateVersion === "number" ? input.__durableStateVersion : undefined,
    });
    if (durableOutcome.state !== "succeeded") {
      return {
        ok: false,
        errorCode: `durable_action_${durableOutcome.state}`,
        errorMessage:
          durableOutcome.state === "unknown"
            ? "Outlook may have accepted this request. It is blocked from retry until the provider outcome is reconciled."
            : "The email action could not be completed safely.",
        data: durableOutcome.result,
      };
    }
    return { ok: true, data: durableOutcome.result };
    /*
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
        : `Please find attached: ${selected.map(({ doc }) => doc.title).join(", ")}.\n\nSent from Atelier on behalf of ${ctx.persona.name}.`;
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
    */
  },
});

export const DOCUMENT_EMAIL_CAPABILITIES_LOADED = true;
