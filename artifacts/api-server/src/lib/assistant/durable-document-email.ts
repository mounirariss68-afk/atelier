import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  atelierAssistantActions,
  atelierAssistantOutbox,
  atelierDocuments,
  atelierDocumentVersions,
  atelierLegalEntities,
  atelierLegalEntityBundleDefinitions,
  atelierMsConnections,
} from "@workspace/db";
import {
  claimDurableAction,
  completeDurableAction,
  confirmDurableAction,
  createDurableActionPreviewTx,
  digestAssistantValue,
  encryptAssistantValue,
  withAssistantRlsTransaction,
} from "./action-runtime.js";
import { evaluateAssistantPolicy } from "./control-runtime.js";
import { findByToolName } from "../atelier-cli/capability-catalog.js";
import {
  loadVisibleLibraryPairs,
  type LibPair,
} from "../atelier-cli/document-email-shared.js";
import {
  createDraftMessage,
  hasMailDraftScope,
  hasMailSendScope,
  sendMailMessage,
  MsAuthError,
  MsGraphError,
  type MsMailAttachment,
} from "../msGraph.js";
import { loadDocBytes } from "../atelier-documents.js";
import { type ToolContext, type ToolResult } from "../atelier-cli/index.js";

const CAPABILITY_ID = "document.email";
const POLICY_VERSION = "riser-policy-v1";
const EXPIRY_MS = 10 * 60_000;
const EXECUTION_STALE_MS = 15 * 60_000;
const MAX_BYTES = 3 * 1024 * 1024;

type EmailInput = {
  documentIds: string[];
  versionIds: string[];
  to: string[];
  subject?: string;
  message?: string;
  mode: "draft" | "send";
  semanticContext?: {
    entityId: string;
    entityLabel: string;
    entityUpdatedAt: string;
    bundleDefinitionId: string;
    bundleKey: string;
    bundleVersion: number;
    concepts: string[];
  };
  __durableActionId?: string;
  __durableStateVersion?: number;
};

type Persona = ToolContext["persona"];

export function executingDocumentEmailState(
  claimedAt: Date | null,
  updatedAt: Date,
  nowMs = Date.now(),
): "in_progress" | "stale" {
  const startedAt = claimedAt?.getTime() ?? updatedAt.getTime();
  return nowMs - startedAt < EXECUTION_STALE_MS ? "in_progress" : "stale";
}

function durableEnabled(): boolean {
  return process.env.DURABLE_DOCUMENT_EMAIL_ENABLED !== "false";
}

export function isAmbiguousTransportError(error: unknown): boolean {
  if (error instanceof MsAuthError) return false;
  if (error instanceof MsGraphError) {
    return error.status === 408 || error.status >= 500;
  }
  return true;
}

type ReplayCandidate = Pick<
  typeof atelierAssistantActions.$inferSelect,
  "id" | "state" | "stateVersion" | "result" | "expiresAt"
>;

export function documentEmailReplayDisposition(
  candidates: ReplayCandidate[],
  nowMs = Date.now(),
):
  | { kind: "new" }
  | { kind: "reuse"; actionId: string; stateVersion: number }
  | { kind: "blocked"; reason: "provider_outcome_unknown" | "execution_in_progress" } {
  for (const candidate of candidates) {
    if (
      candidate.state === "failed" &&
      (candidate.result as { outcome?: string } | null)?.outcome === "unknown"
    ) {
      return { kind: "blocked", reason: "provider_outcome_unknown" };
    }
    if (candidate.state === "executing") {
      return { kind: "blocked", reason: "execution_in_progress" };
    }
    if (
      (candidate.state === "awaiting_confirmation" || candidate.state === "confirmed") &&
      candidate.expiresAt.getTime() > nowMs
    ) {
      return {
        kind: "reuse",
        actionId: candidate.id,
        stateVersion: candidate.stateVersion,
      };
    }
  }
  return { kind: "new" };
}

async function exactTargetsCurrent(orgId: string, targets: unknown[]): Promise<boolean> {
  if (!Array.isArray(targets) || targets.length === 0) return false;
  for (const target of targets) {
    if (!target || typeof target !== "object") return false;
    const row = target as Record<string, unknown>;
    if (row.type === "legal_entity") {
      if (typeof row.id !== "string" || typeof row.updatedAt !== "string") return false;
      const [entity] = await db.select({
        status: atelierLegalEntities.status,
        updatedAt: atelierLegalEntities.updatedAt,
      }).from(atelierLegalEntities).where(and(
        eq(atelierLegalEntities.id, row.id),
        eq(atelierLegalEntities.orgId, orgId),
      ));
      if (!entity || entity.status === "archived" || entity.updatedAt.toISOString() !== row.updatedAt) return false;
      continue;
    }
    if (row.type === "legal_entity_bundle") {
      if (typeof row.id !== "string" || typeof row.entityId !== "string" || typeof row.version !== "number") return false;
      const [bundle] = await db.select({
        status: atelierLegalEntityBundleDefinitions.status,
        entityId: atelierLegalEntityBundleDefinitions.entityId,
        version: atelierLegalEntityBundleDefinitions.version,
      }).from(atelierLegalEntityBundleDefinitions).where(and(
        eq(atelierLegalEntityBundleDefinitions.id, row.id),
        eq(atelierLegalEntityBundleDefinitions.orgId, orgId),
      ));
      if (!bundle || bundle.status !== "active" || bundle.entityId !== row.entityId || bundle.version !== row.version) return false;
      continue;
    }
    if (row.type !== "document" || typeof row.id !== "string" ||
        typeof row.versionId !== "string" || typeof row.updatedAt !== "string") return false;
    const [doc] = await db
      .select({ updatedAt: atelierDocuments.updatedAt, currentVersionId: atelierDocuments.currentVersionId })
      .from(atelierDocuments)
      .where(and(
        eq(atelierDocuments.id, row.id),
        eq(atelierDocuments.orgId, orgId),
        eq(atelierDocuments.status, "active"),
        isNull(atelierDocuments.deletedAt),
      ));
    if (!doc || doc.currentVersionId !== row.versionId || doc.updatedAt.toISOString() !== row.updatedAt) {
      return false;
    }
    const [version] = await db
      .select({ id: atelierDocumentVersions.id, documentId: atelierDocumentVersions.documentId, blobRef: atelierDocumentVersions.blobRef })
      .from(atelierDocumentVersions)
      .where(and(
        eq(atelierDocumentVersions.id, row.versionId),
        eq(atelierDocumentVersions.documentId, row.id),
      ));
    if (!version?.blobRef) return false;
  }
  return true;
}

export async function createDurableDocumentEmailPreview(args: {
  persona: Persona;
  conversationId: string;
  turnId: string;
  step: number;
  input: EmailInput;
  selected: LibPair[];
  recipientLabels: string[];
  semanticContext?: EmailInput["semanticContext"];
}): Promise<{ actionId: string; stateVersion: number }> {
  if (!durableEnabled()) throw new Error("durable-document-email-disabled");
  const capability = findByToolName("email_company_documents");
  if (!capability || capability.id !== CAPABILITY_ID || !capability.isWrite) {
    throw new Error("durable-document-email-capability-unavailable");
  }
  const selected = args.selected.map(({ doc, version }) => {
    if (!version?.id || !version.blobRef) throw new Error("durable-document-email-version-missing");
    return { doc, version };
  });
  const canonicalInput: EmailInput = {
    documentIds: selected.map(({ doc }) => doc.id),
    versionIds: selected.map(({ version }) => version.id),
    to: [...args.input.to],
    mode: args.input.mode,
    ...(args.input.subject !== undefined ? { subject: args.input.subject } : {}),
    ...(args.input.message !== undefined ? { message: args.input.message } : {}),
    ...(args.semanticContext ? { semanticContext: args.semanticContext } : {}),
  };
  const policy = await evaluateAssistantPolicy({
    orgId: args.persona.orgId,
    capabilityId: CAPABILITY_ID,
    baseAllowed: true,
    obligations: ["fresh_confirmation"],
    policyVersion: POLICY_VERSION,
  });
  if (policy.effect !== "allow") throw new Error("durable-document-email-policy-denied");
  const targets = selected.map(({ doc, version }) => ({
    type: "document",
    id: doc.id,
    versionId: version.id,
    updatedAt: doc.updatedAt.toISOString(),
  }));
  if (args.semanticContext) {
    targets.push({
      type: "legal_entity",
      id: args.semanticContext.entityId,
      versionId: "",
      updatedAt: args.semanticContext.entityUpdatedAt,
    });
    targets.push({
      type: "legal_entity_bundle",
      id: args.semanticContext.bundleDefinitionId,
      entityId: args.semanticContext.entityId,
      version: args.semanticContext.bundleVersion,
      versionId: "",
      updatedAt: "",
    } as never);
  }
  const previewArgs = {
    orgId: args.persona.orgId,
    requesterId: args.persona.id,
    conversationId: args.conversationId,
    sourceTurnId: args.turnId,
    capabilityId: CAPABILITY_ID,
    inputSchemaVersion: capability.schemaVersion,
    canonicalInput,
    targetRefsAndRevisions: targets,
    policyDecision: policy,
    riskClass: args.input.mode === "send" ? "high" : "write",
    irreversible: args.input.mode === "send",
    outboundChannels: ["email"],
    summary: `${args.input.mode === "send" ? "Send" : "Create draft"} with ${selected.length} document(s)${args.semanticContext ? ` for ${args.semanticContext.entityLabel}` : ""}`,
    diff: {
      mode: args.input.mode,
      recipients: args.recipientLabels,
      documentIds: selected.map(({ doc }) => doc.id),
      versionIds: selected.map(({ version }) => version.id),
      ...(args.semanticContext ? {
        legalEntity: {
          id: args.semanticContext.entityId,
          label: args.semanticContext.entityLabel,
        },
        bundle: {
          key: args.semanticContext.bundleKey,
          version: args.semanticContext.bundleVersion,
          concepts: args.semanticContext.concepts,
        },
      } : {}),
    },
    expiresAt: new Date(Date.now() + EXPIRY_MS),
    idempotencyKey: `durable:${args.turnId}:${args.step}:document-email`,
  };
  const inputDigest = digestAssistantValue(canonicalInput);
  const created = await withAssistantRlsTransaction({
    orgId: args.persona.orgId,
    requesterId: args.persona.id,
  }, async (tx) => {
    // Graph does not offer exactly-once draft creation. Serialize identical
    // requests and refuse a fresh action while an earlier provider outcome is
    // unknown or still executing, even when the replay arrives in a new turn.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(
      hashtext(${"document-email-replay"}),
      hashtext(${`${args.persona.orgId}:${args.persona.id}:${inputDigest}`})
    )`);
    const candidates = await tx
      .select({
        id: atelierAssistantActions.id,
        state: atelierAssistantActions.state,
        stateVersion: atelierAssistantActions.stateVersion,
        result: atelierAssistantActions.result,
        expiresAt: atelierAssistantActions.expiresAt,
      })
      .from(atelierAssistantActions)
      .where(and(
        eq(atelierAssistantActions.orgId, args.persona.orgId),
        eq(atelierAssistantActions.requesterId, args.persona.id),
        eq(atelierAssistantActions.capabilityId, CAPABILITY_ID),
        eq(atelierAssistantActions.inputDigest, inputDigest),
      ))
      .orderBy(desc(atelierAssistantActions.updatedAt))
      .limit(20);
    const disposition = documentEmailReplayDisposition(candidates);
    if (disposition.kind === "blocked") {
      throw new Error(`durable-document-email-${disposition.reason}`);
    }
    if (disposition.kind === "reuse") {
      return {
        actionId: disposition.actionId,
        preview: null,
        stateVersion: disposition.stateVersion,
      };
    }
    return createDurableActionPreviewTx(tx, previewArgs);
  });
  return { actionId: created.actionId, stateVersion: created.stateVersion };
}

async function recordOutbox(args: {
  actionId: string;
  orgId: string;
  requesterId: string;
  input: EmailInput;
}): Promise<boolean> {
  const inserted = await withAssistantRlsTransaction(args, (tx) => tx
    .insert(atelierAssistantOutbox).values({
      id: `outbox_${args.actionId}`,
      orgId: args.orgId,
      actionId: args.actionId,
      destination: "microsoft_graph_mail",
      providerIdempotencyKey: args.actionId,
      requestEncrypted: encryptAssistantValue(args.input),
      state: "sending",
    }).onConflictDoNothing({
      target: [
        atelierAssistantOutbox.destination,
        atelierAssistantOutbox.providerIdempotencyKey,
      ],
    }).returning({ id: atelierAssistantOutbox.id }));
  return inserted.length > 0;
}

export async function confirmAndExecuteDurableDocumentEmail(args: {
  actionId: string;
  orgId: string;
  requesterId: string;
  persona: Persona;
  expectedStateVersion?: number;
}): Promise<{ state: string; result: unknown }> {
  const [action] = await withAssistantRlsTransaction(args, (tx) => tx
    .select().from(atelierAssistantActions).where(and(
      eq(atelierAssistantActions.id, args.actionId),
      eq(atelierAssistantActions.orgId, args.orgId),
      eq(atelierAssistantActions.requesterId, args.requesterId),
      eq(atelierAssistantActions.capabilityId, CAPABILITY_ID),
    )));
  if (!action) throw new Error("durable-document-email-action-not-found");
  if (action.state === "failed" && (action.result as { outcome?: string } | null)?.outcome === "unknown") {
    return { state: "unknown", result: action.result };
  }
  if (action.state === "succeeded" || action.state === "failed" || action.state === "invalidated" || action.state === "expired") {
    return { state: action.state, result: action.result };
  }
  if (action.state === "executing") {
    if (executingDocumentEmailState(action.claimedAt, action.updatedAt) === "in_progress") {
      return {
        state: "executing",
        result: {
          outcome: "in_progress",
          retryBlocked: true,
          message: "Outlook execution is already in progress.",
        },
      };
    }
    const [outbox] = await withAssistantRlsTransaction(args, (tx) => tx
      .select({ state: atelierAssistantOutbox.state })
      .from(atelierAssistantOutbox)
      .where(eq(atelierAssistantOutbox.actionId, action.id))
      .limit(1));
    const result = {
      outcome: "unknown",
      retryBlocked: true,
      message:
        outbox
          ? "Outlook execution was interrupted after its durable provider claim; reconcile before retrying."
          : "Outlook execution was interrupted while being prepared; reconcile before retrying.",
    };
    const terminal = await completeDurableAction({
      actionId: action.id,
      orgId: action.orgId,
      requesterId: action.requesterId,
      fencingToken: action.executorFence,
      status: "failed",
      result,
    });
    const terminalUnknown =
      terminal.state === "failed" &&
      (terminal.result as { outcome?: string } | null)?.outcome === "unknown";
    if (terminalUnknown) {
      await withAssistantRlsTransaction(args, (tx) => tx
        .update(atelierAssistantOutbox)
        .set({
          state: "unknown",
          providerResult: terminal.result,
          lastErrorCode: "interrupted_execution",
          updatedAt: new Date(),
        })
        .where(and(
          eq(atelierAssistantOutbox.actionId, action.id),
          eq(atelierAssistantOutbox.state, "sending"),
        )));
    }
    return {
      state: terminalUnknown ? "unknown" : terminal.state,
      result: terminal.result,
    };
  }
  if (action.state === "awaiting_confirmation") {
    if (args.expectedStateVersion !== action.stateVersion) throw new Error("durable-document-email-state-version-mismatch");
    await confirmDurableAction({
      actionId: action.id,
      orgId: action.orgId,
      requesterId: action.requesterId,
      expectedStateVersion: action.stateVersion,
      recheckPolicy: async () => policyForAction(action),
    });
  }
  if (!durableEnabled()) throw new Error("durable-document-email-disabled");
  const policy = await policyForAction(action);
  const claim = await claimDurableAction({
    actionId: action.id,
    orgId: action.orgId,
    requesterId: action.requesterId,
    recheckPolicy: async () => policy,
    recheckTargets: (targets) => exactTargetsCurrent(action.orgId, targets),
  });
  if (!claim) {
    const [current] = await withAssistantRlsTransaction(args, (tx) => tx
      .select({ state: atelierAssistantActions.state, result: atelierAssistantActions.result })
      .from(atelierAssistantActions).where(eq(atelierAssistantActions.id, action.id)));
    if (current?.result && (current.result as { outcome?: string }).outcome === "unknown") {
      return { state: "unknown", result: current.result };
    }
    return { state: current?.state ?? "failed", result: current?.result ?? null };
  }
  const input = claim.input as EmailInput;
  const ctx = { persona: args.persona, turnId: action.sourceTurnId ?? "", sessionId: action.conversationId ?? "", stepIdx: 0 } as ToolContext;
  const visible = await loadVisibleLibraryPairs(ctx);
  if (!visible) {
    const result = { code: "user_not_found" };
    await completeDurableAction({
      actionId: action.id,
      orgId: action.orgId,
      requesterId: action.requesterId,
      fencingToken: claim.fencingToken,
      status: "failed",
      result,
    });
    return { state: "failed", result };
  }
  const byId = new Map(visible.map((pair) => [pair.doc.id, pair]));
  const selected = input.documentIds.map((id, index) => {
    const pair = byId.get(id);
    if (!pair || pair.version?.id !== input.versionIds[index] || !pair.version.blobRef) return null;
    return pair;
  });
  if (selected.some((pair): pair is null => pair === null)) {
    const result = { code: "source_drift", retryRequiresNewPreview: true };
    await completeDurableAction({
      actionId: action.id,
      orgId: action.orgId,
      requesterId: action.requesterId,
      fencingToken: claim.fencingToken,
      status: "failed",
      result,
    });
    return { state: "failed", result };
  }
  const validSelected = selected as LibPair[];
  const [conn] = await db.select().from(atelierMsConnections)
    .where(eq(atelierMsConnections.userId, args.requesterId)).limit(1);
  if (!conn) {
    const result = { code: "ms_not_connected" };
    await completeDurableAction({
      actionId: action.id,
      orgId: action.orgId,
      requesterId: action.requesterId,
      fencingToken: claim.fencingToken,
      status: "failed",
      result,
    });
    return { state: "failed", result };
  }
  const { freshAccessToken } = await import("../msScheduling.js");
  let accessToken: string;
  let scopes: string[];
  try {
    const fresh = await freshAccessToken(conn);
    accessToken = fresh.accessToken;
    scopes = fresh.scopes;
  } catch (error) {
    await completeDurableAction({ actionId: action.id, orgId: action.orgId, requesterId: action.requesterId, fencingToken: claim.fencingToken, status: "failed", result: { code: "ms_reconnect_required" } });
    return { state: "failed", result: { code: "ms_reconnect_required" } };
  }
  if (input.mode === "send" ? !hasMailSendScope(scopes) : !hasMailDraftScope(scopes)) {
    await completeDurableAction({ actionId: action.id, orgId: action.orgId, requesterId: action.requesterId, fencingToken: claim.fencingToken, status: "failed", result: { code: "ms_reconnect_required" } });
    return { state: "failed", result: { code: "ms_reconnect_required" } };
  }
  const attachments: MsMailAttachment[] = [];
  for (const pair of validSelected) {
    const bytes = await loadDocBytes(pair.version!.blobRef!);
    if (!bytes || bytes.byteLength > MAX_BYTES) {
      await completeDurableAction({ actionId: action.id, orgId: action.orgId, requesterId: action.requesterId, fencingToken: claim.fencingToken, status: "failed", result: { code: "file_missing_or_too_large" } });
      return { state: "failed", result: { code: "file_missing_or_too_large" } };
    }
    attachments.push({ name: pair.version!.fileName || `${pair.doc.title}.pdf`, contentType: pair.version!.mime || "application/octet-stream", contentBytes: bytes });
  }
  if (!(await recordOutbox({
    actionId: action.id,
    orgId: action.orgId,
    requesterId: action.requesterId,
    input,
  }))) {
    const result = {
      code: "provider_already_started",
      outcome: "unknown",
      retryBlocked: true,
    };
    await completeDurableAction({
      actionId: action.id,
      orgId: action.orgId,
      requesterId: action.requesterId,
      fencingToken: claim.fencingToken,
      status: "failed",
      result,
    });
    return { state: "unknown", result };
  }
  const subject = input.subject?.trim() || `Documents from ${args.persona.name}`;
  const bodyText = input.message?.trim() || `Please find attached: ${validSelected.map(({ doc }) => doc.title).join(", ")}.\n\nSent from Atelier on behalf of ${args.persona.name}.`;
  try {
    const to = input.to.map((email) => ({ email }));
    if (input.mode === "send") await sendMailMessage(accessToken, { subject, bodyText, to, attachments });
    else await createDraftMessage(accessToken, { subject, bodyText, to, attachments });
    await withAssistantRlsTransaction(args, (tx) => tx
      .update(atelierAssistantOutbox)
      .set({ state: "delivered", providerResult: { outcome: "succeeded" }, updatedAt: new Date() })
      .where(eq(atelierAssistantOutbox.actionId, action.id)));
    const completed = await completeDurableAction({
      actionId: action.id,
      orgId: action.orgId,
      requesterId: action.requesterId,
      fencingToken: claim.fencingToken,
      status: "succeeded",
      result: { mode: input.mode, outcome: "succeeded" },
    });
    return { state: completed.state, result: completed.result };
  } catch (error) {
    const unknown = isAmbiguousTransportError(error);
    await withAssistantRlsTransaction(args, (tx) => tx
      .update(atelierAssistantOutbox)
      .set({ state: unknown ? "unknown" : "failed", providerResult: { outcome: unknown ? "unknown" : "failed", retryBlocked: unknown }, lastErrorCode: error instanceof Error ? error.name : "provider_error", updatedAt: new Date() })
      .where(eq(atelierAssistantOutbox.actionId, action.id)));
    const result = unknown ? { outcome: "unknown", retryBlocked: true, message: "Outlook may have accepted the request; reconcile before retrying." } : { outcome: "failed", code: error instanceof MsGraphError ? `graph_${error.status}` : "provider_error" };
    const terminal = await completeDurableAction({ actionId: action.id, orgId: action.orgId, requesterId: action.requesterId, fencingToken: claim.fencingToken, status: "failed", result });
    return { state: unknown ? "unknown" : terminal.state, result };
  }
}

async function policyForAction(action: typeof atelierAssistantActions.$inferSelect) {
  return evaluateAssistantPolicy({
    orgId: action.orgId,
    capabilityId: CAPABILITY_ID,
    baseAllowed: true,
    obligations: ["fresh_confirmation"],
    policyVersion: action.policyVersion,
  });
}