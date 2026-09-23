/**
 * Pure prototype lifecycle rules. Kept outside the route module so the SLA
 * boundary can be tested without a database or server bootstrap.
 */
export type PrototypeSlaOutcome = "on_time" | "late";
const transitions: Record<string, readonly string[]> = {
  requested: ["requested", "scoping", "cancelled"],
  scoping: ["scoping", "approved", "cancelled"],
  approved: ["approved", "building", "cancelled"],
  building: ["building", "ready", "cancelled"],
  ready: ["ready", "delivered", "cancelled"],
  delivered: ["delivered"],
  cancelled: ["cancelled"],
};

export function isPrototypeTransitionAllowed(from: string, to: string) {
  return transitions[from]?.includes(to) ?? false;
}

export function prototypeSlaOutcome(deliveredAt: Date, dueAt: Date): PrototypeSlaOutcome {
  return deliveredAt.getTime() <= dueAt.getTime() ? "on_time" : "late";
}

export function prototypeTransitionFields(status: string, deliveredAt: Date | null, dueAt: Date) {
  if (status === "delivered") {
    const delivered = deliveredAt ?? new Date();
    return { deliveredAt: delivered, slaOutcome: prototypeSlaOutcome(delivered, dueAt) };
  }
  return { deliveredAt: null, slaOutcome: null };
}