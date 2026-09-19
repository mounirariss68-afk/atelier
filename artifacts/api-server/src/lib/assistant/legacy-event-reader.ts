import { upcastPersistedTurnV1 } from "@workspace/assistant-protocol";

interface DurableEventRow {
  id: string;
  protocolVersion: number;
  conversationId: string;
  turnId: string;
  sequence: number;
  conversationSequence: number;
  occurredAt: Date;
  correlationId: string;
  type: string;
  data: unknown;
}

interface LegacyTurnRow {
  id: string;
  status: string;
  prompt: string;
  frames: unknown[];
  pendingWrite: unknown;
  createdAt: Date;
}

export function mergeAssistantReplayEvents(args: {
  conversationId: string;
  durable: DurableEventRow[];
  legacy: LegacyTurnRow[];
  after: string | null;
  limit?: number;
}) {
  const supersededLegacyIds = new Set(
    args.durable.flatMap((event) => {
      const data = event.data && typeof event.data === "object" && !Array.isArray(event.data)
        ? event.data as Record<string, unknown>
        : null;
      return typeof data?.legacyEventId === "string" ? [data.legacyEventId] : [];
    }),
  );
  const durable = args.durable.map((event) => ({
    protocolVersion: event.protocolVersion,
    conversationId: event.conversationId,
    turnId: event.turnId,
    eventId: event.id,
    sequence: event.sequence,
    occurredAt: event.occurredAt.toISOString(),
    correlationId: event.correlationId,
    type: event.type,
    data: event.data,
    cursor: `${event.occurredAt.toISOString()}|durable|${event.id}`,
    source: "durable" as const,
  }));
  const legacy = args.legacy.flatMap((turn) => {
    const canonical = upcastPersistedTurnV1({
      turnId: turn.id,
      status: turn.status,
      prompt: turn.prompt,
      frames: turn.frames,
      pendingWrite: turn.pendingWrite,
    });
    return canonical.frames
      .filter((frame) =>
        !supersededLegacyIds.has(`legacy:${turn.id}:${frame.sequence}`))
      .map((frame) => ({
        protocolVersion: 1,
        conversationId: args.conversationId,
        turnId: turn.id,
        eventId: `legacy:${turn.id}:${frame.sequence}`,
        sequence: frame.sequence,
        occurredAt: new Date(
          turn.createdAt.getTime() + frame.sequence,
        ).toISOString(),
        correlationId: turn.id,
        type: frame.type,
        data: frame.type === "compatibility.quarantined"
          ? { reason: canonical.quarantineReasons.find((reason) =>
              reason === `unknown_frame_type:${frame.sequence}`) }
          : frame.data,
        cursor: `${new Date(
          turn.createdAt.getTime() + frame.sequence,
        ).toISOString()}|legacy|${turn.id}|${String(frame.sequence).padStart(6, "0")}`,
        source: "legacy" as const,
      }));
  });
  const merged = [...durable, ...legacy].sort((left, right) =>
    left.cursor.localeCompare(right.cursor));
  const limit = Math.max(1, Math.min(args.limit ?? 1_000, 1_000));
  return merged
    .filter((event) => args.after === null || event.cursor > args.after)
    .slice(0, limit);
}