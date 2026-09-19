/**
 * Source-level guard for the destructive roster flow. This stays executable
 * without DATABASE_URL and catches regressions where a future edit moves the
 * dependency check outside the deletion transaction or drops a safety gate.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(import.meta.dirname, "../../src/routes/atelier/rosterLifecycleRoutes.ts"),
  "utf8",
);

const required = [
  'router.get("/roster/people/:id/removal-check"',
  'router.post("/roster/people/:id/archive"',
  'router.delete("/roster/people/:id"',
  "identity-confirmation-required",
  "demo-person-protected",
  "pg_advisory_xact_lock",
  "removalDependencies(person, me.orgId, tx)",
  "atelierAuthSessions",
  "atelierLoginActivationTokens",
  "roster.person.archived",
  "roster.person.removed",
];

for (const marker of required) {
  if (!source.includes(marker)) {
    throw new Error(`roster-removal safety marker missing: ${marker}`);
  }
}

const transactionStart = source.indexOf("await db.transaction(async (tx) => {");
const lockedRecheck = source.indexOf("removalDependencies(person, me.orgId, tx)", transactionStart);
const firstPermanentDelete = source.indexOf("await tx.delete(atelierEmployees)", transactionStart);
if (transactionStart < 0 || lockedRecheck < transactionStart || firstPermanentDelete < lockedRecheck) {
  throw new Error("permanent deletion is not guarded by an in-transaction dependency recheck");
}

process.stdout.write("roster-removal source probe: ok\n");