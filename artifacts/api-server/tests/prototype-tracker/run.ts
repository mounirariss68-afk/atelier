import assert from "node:assert/strict";
import {
  isPrototypeTransitionAllowed,
  prototypeSlaOutcome,
  prototypeTransitionFields,
} from "../../src/lib/atelier-prototype-tracker.js";

const due = new Date("2026-01-01T12:00:00.000Z");
assert.equal(prototypeSlaOutcome(new Date(due), due), "on_time");
assert.equal(prototypeSlaOutcome(new Date("2026-01-01T12:00:00.001Z"), due), "late");

const delivered = new Date("2026-01-01T11:00:00.000Z");
assert.deepEqual(prototypeTransitionFields("delivered", delivered, due), {
  deliveredAt: delivered,
  slaOutcome: "on_time",
});
assert.deepEqual(prototypeTransitionFields("building", delivered, due), {
  deliveredAt: null,
  slaOutcome: null,
});
assert.equal(isPrototypeTransitionAllowed("ready", "delivered"), true);
assert.equal(isPrototypeTransitionAllowed("delivered", "building"), false);
assert.equal(isPrototypeTransitionAllowed("cancelled", "requested"), false);

console.log("prototype tracker pure checks passed");