/**
 * Task #828 — chat write → Me documents refresh probe (pure, no expo).
 *
 * Pins:
 *   1. A server-authoritative COMMITTED outcome with navigateTo
 *      when:"on_commit" → /me/profile yields the my-documents +
 *      my-profile query keys, so the Me tab list refetches.
 *   2. Pre-confirm previews, prelude results, failures, and commits
 *      that navigate elsewhere yield NO invalidations.
 *   3. Once the list refetches, the wire `sides: "front_back"` clears
 *      the "Back side missing" indicator (which renders only for
 *      national_id + sides === "front_only").
 *
 * Run: pnpm --filter @workspace/atelier-mobile exec tsx tests/doc-refresh-probe.ts
 */
import {
  getAtelierGetMyProfileQueryKey,
  getAtelierListMyDocumentsQueryKey,
} from "@workspace/api-client-react";

import { commitInvalidationKeys } from "../lib/chatWriteInvalidation";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

const beforeCommit = {
  protocolMode: "current",
  commitState: "proposed",
  lastSequence: 4,
  navigateTo: { path: "/me/profile", when: "on_propose" },
};
const afterCommit = {
  protocolMode: "current",
  commitState: "committed",
  lastSequence: 5,
  navigateTo: { path: "/me/profile", when: "on_commit" },
};

// 1. Committed document write → docs + profile keys.
const keys = commitInvalidationKeys(beforeCommit, afterCommit);
const flat = keys.map((k) => JSON.stringify(k));
check(
  "commit to /me/profile invalidates my-documents",
  flat.includes(JSON.stringify(getAtelierListMyDocumentsQueryKey())),
  flat,
);
check(
  "commit to /me/profile invalidates my-profile",
  flat.includes(JSON.stringify(getAtelierGetMyProfileQueryKey())),
  flat,
);

// 2a. No accepted commit transition — nothing to invalidate.
check(
  "proposed state does not invalidate",
  commitInvalidationKeys(beforeCommit, {
    ...beforeCommit,
    lastSequence: 5,
  }).length === 0,
);

// 2b. Duplicate/replayed committed state does not re-invalidate.
check(
  "duplicate committed state does not invalidate twice",
  commitInvalidationKeys(afterCommit, { ...afterCommit, lastSequence: 6 }).length === 0,
);

// 2c. Failed tool → nothing.
check(
  "failed state does not invalidate",
  commitInvalidationKeys(beforeCommit, {
    ...beforeCommit,
    commitState: "failed",
    lastSequence: 5,
  }).length === 0,
);

// 2d. on_propose navigation is not a commit.
check(
  "on_propose navigateTo does not invalidate",
  commitInvalidationKeys(beforeCommit, {
    ...beforeCommit,
    lastSequence: 5,
  }).length === 0,
);

// 2e. Commit elsewhere (meeting write) does not touch document queries.
check(
  "commit to another surface does not invalidate documents",
  commitInvalidationKeys(beforeCommit, {
    ...afterCommit,
    navigateTo: { path: "/me/meetings", when: "on_commit" },
  }).length === 0,
);

// 2f. Legacy state and rejected duplicate sequence cannot authorize effects.
check(
  "legacy mode does not invalidate",
  commitInvalidationKeys(
    { ...beforeCommit, protocolMode: "legacy" },
    { ...afterCommit, protocolMode: "legacy" },
  ).length === 0,
);
check(
  "non-increasing sequence does not invalidate",
  commitInvalidationKeys(beforeCommit, {
    ...afterCommit,
    lastSequence: beforeCommit.lastSequence,
  }).length === 0,
);

// 3. "Back side missing" indicator condition (mirrors me.tsx render:
//    shown only for national_id with sides === "front_only").
const backMissingShown = (doc: { kind: string; sides?: string }) =>
  doc.kind === "national_id" && doc.sides === "front_only";
check(
  "front_only national ID shows Back side missing",
  backMissingShown({ kind: "national_id", sides: "front_only" }),
);
check(
  "front_back wire clears Back side missing",
  !backMissingShown({ kind: "national_id", sides: "front_back" }),
);

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll doc-refresh probes passed.");
