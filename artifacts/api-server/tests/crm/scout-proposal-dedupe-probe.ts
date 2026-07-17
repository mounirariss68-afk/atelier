/**
 * Task #14 — regression probe for proposeProfileUpdatesFromScout dedupe.
 * Re-running the Pursuit Scout on an account must NOT flood the review queue
 * with repeated proposals. Covers:
 *   1. candidate matching an existing PENDING proposal → skipped
 *   2. candidate matching a previously REJECTED proposal → skipped
 *   3. APPROVED proposal whose value is now live → no-op skip (not re-proposed)
 *   4. live-value no-op (strategicPriorities already contains fact) → skipped
 *   5. sourceSignals URL already inside a pending sourceSignals proposal → skipped
 *   6. positive control — a genuinely new signal DOES enqueue a proposal
 *
 * Calls the exported function directly (no LLM involved); provisions ephemeral
 * user/account/opportunity rows and cleans up in finally.
 * Run: pnpm exec tsx tests/crm/scout-proposal-dedupe-probe.ts
 */
process.env.ATELIER_MOCK_AGENTS = process.env.ATELIER_MOCK_AGENTS ?? "1";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

async function main() {
  const { db, pool, atelierUsers, atelierAccounts, atelierOpportunities, atelierAuditEvents } =
    await import("@workspace/db");
  const { eq, and } = await import("drizzle-orm");
  const runner = await import("../../src/lib/atelier-agents/runner.js");
  const { proposeProfileUpdatesFromScout } = runner as {
    proposeProfileUpdatesFromScout: (args: {
      opportunityId: string;
      proposedBy: string;
      output: unknown;
    }) => Promise<void>;
  };

  const runTag = `probe14_${Date.now()}`;
  const userId = `u_${runTag}`;
  const acctId = `acct_${runTag}`;
  const oppId = `opp_${runTag}`;
  const AGENT = "agent_pursuit_scout";

  // Exact statements the scout facts will carry — the dedupe key is
  // field + toValue where toValue is statement.slice(0, 100).
  const SECTOR_STMT = "Operates primarily in the maritime logistics sector across the Gulf region";
  const HQ_STMT = "The company is headquartered in Muscat with a satellite head office in Salalah";
  const LIVE_PRIORITY = "Top priority is expanding strategic operations into Saudi Arabia";
  const APPROVED_LIVE_SECTOR = SECTOR_STMT.slice(0, 100);
  const DUPE_URL = "https://dupe.example.test/pending-signal";
  const NEW_URL = "https://fresh.example.test/new-signal";

  const now = new Date().toISOString();
  const mkProposal = (
    field: string,
    toValue: unknown,
    status: "pending" | "approved" | "rejected",
  ) => ({
    id: `pp_seed_${field}_${status}`,
    proposedBy: AGENT,
    proposedAt: now,
    field,
    fromValue: null,
    toValue,
    rationale: "seeded for dedupe probe",
    status,
  });

  const queueLen = async () => {
    const [a] = await db.select().from(atelierAccounts).where(eq(atelierAccounts.id, acctId));
    return ((a?.pendingProfileUpdates as unknown[] | null) ?? []).length;
  };
  const queue = async () => {
    const [a] = await db.select().from(atelierAccounts).where(eq(atelierAccounts.id, acctId));
    return ((a?.pendingProfileUpdates as Array<{ field: string; status: string }> | null) ?? []);
  };
  const run = (facts: Array<Record<string, unknown>>) =>
    proposeProfileUpdatesFromScout({
      opportunityId: oppId,
      proposedBy: AGENT,
      output: { facts },
    });

  try {
    await db.insert(atelierUsers).values({
      id: userId,
      orgId: "aico",
      name: "Probe Fourteen",
      initials: "PF",
      email: `${runTag}@example.test`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);
    await db.insert(atelierAccounts).values({
      id: acctId,
      orgId: "aico",
      name: `Probe Fourteen Co ${runTag}`,
      country: "OM",
      // Case 3: an APPROVED sector proposal has already been applied — the
      // live value equals what the scout will propose again.
      sector: APPROVED_LIVE_SECTOR,
      tier: "C",
      partnerOwnerId: userId,
      hqCity: null,
      strategicPriorities: [LIVE_PRIORITY],
      sourceSignals: [],
      pendingProfileUpdates: [
        // Case 1: pending proposal — same field+toValue must be blocked.
        mkProposal("hqCity", HQ_STMT.slice(0, 100), "pending"),
        // Case 3: the approved proposal (does not block by itself; the
        // no-op-vs-live check is what must prevent re-proposal).
        mkProposal("sector", APPROVED_LIVE_SECTOR, "approved"),
        // Case 5: pending sourceSignals proposal already carrying DUPE_URL.
        mkProposal("sourceSignals", [{ kind: "news", title: "Dupe", url: DUPE_URL }], "pending"),
      ],
    } as any);
    await db.insert(atelierOpportunities).values({
      id: oppId,
      orgId: "aico",
      slug: `probe-14-${Date.now()}`,
      name: `Probe opp ${runTag}`,
      accountId: acctId,
      partnerOwnerId: userId,
      engagementLeadId: userId,
      dealSizeHypothesis: 100000,
      probabilityPct: 10,
      nextMilestone: "Probe milestone",
      nextMilestoneDate: new Date(),
      sourceLead: "Probe seed",
    } as any);

    const baseline = await queueLen();
    check("baseline queue seeded with 3 entries", baseline === 3, baseline);

    // --- Case 1: HQ candidate matches an existing PENDING proposal ---
    await run([{ statement: HQ_STMT, topic: "hq" }]);
    check("pending duplicate skipped (hqCity)", (await queueLen()) === baseline, await queue());

    // --- Case 2: candidate matches a previously REJECTED proposal ---
    // Flip the seeded hqCity proposal to rejected, then re-run the same fact.
    const q1 = ((await db.select().from(atelierAccounts).where(eq(atelierAccounts.id, acctId)))[0]!
      .pendingProfileUpdates as Array<any>).map((p) =>
      p.field === "hqCity" ? { ...p, status: "rejected" } : p,
    );
    await db
      .update(atelierAccounts)
      .set({ pendingProfileUpdates: q1 })
      .where(eq(atelierAccounts.id, acctId));
    await run([{ statement: HQ_STMT, topic: "hq" }]);
    check("rejected duplicate skipped (hqCity)", (await queueLen()) === baseline, await queue());

    // --- Case 3: approved proposal, value already live → no-op skip ---
    await run([{ statement: SECTOR_STMT, topic: "sector" }]);
    check(
      "approved+live value not re-proposed (sector)",
      (await queueLen()) === baseline,
      await queue(),
    );

    // --- Case 4: strategicPriorities fact already live → no-op skip ---
    await run([{ statement: LIVE_PRIORITY, topic: "priority" }]);
    check(
      "live strategicPriorities no-op skipped",
      (await queueLen()) === baseline,
      await queue(),
    );

    // --- Case 5: sourceSignals URL already inside a pending proposal ---
    await run([{ statement: "General finding about the company", sourceUrl: DUPE_URL, sourceTitle: "Dupe" }]);
    check(
      "sourceSignals URL in pending proposal skipped",
      (await queueLen()) === baseline,
      await queue(),
    );

    // --- Case 6: positive control — a new URL DOES enqueue a proposal ---
    await run([{ statement: "General finding about the company", sourceUrl: NEW_URL, sourceTitle: "Fresh" }]);
    const after = await queue();
    const added = after.filter((p) => p.field === "sourceSignals" && p.status === "pending");
    check("new signal enqueued exactly one extra proposal", after.length === baseline + 1, after);
    check("new proposal is a pending sourceSignals entry", added.length === 2, added); // seeded + new

    // Re-run the identical new-signal fact — must now dedupe against itself.
    await run([{ statement: "General finding about the company", sourceUrl: NEW_URL, sourceTitle: "Fresh" }]);
    check("re-run of same new signal is deduped", (await queueLen()) === baseline + 1, await queue());
  } finally {
    try {
      await db
        .delete(atelierAuditEvents)
        .where(and(eq(atelierAuditEvents.entityType, "account"), eq(atelierAuditEvents.entityId, acctId)));
      const { hardDeleteOpportunities } = await import("../../src/lib/atelier-opportunity-delete.js");
      await hardDeleteOpportunities([oppId]);
      await db.delete(atelierAccounts).where(eq(atelierAccounts.id, acctId));
      await db.delete(atelierUsers).where(eq(atelierUsers.id, userId));
    } catch (e) {
      console.error("cleanup error", e);
    }
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("probe crashed", e);
  process.exit(1);
});
