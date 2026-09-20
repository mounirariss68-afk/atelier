/**
 * Task #17 — regression probe for buildCartographerProposals dedupe.
 * A manual "Refresh profile" re-run must NOT flood the review queue with
 * repeated proposals. Covers:
 *   1. candidate matching an existing PENDING proposal → skipped
 *      (cogniriseHypothesis + contact name/title key)
 *   2. candidate matching a previously REJECTED proposal → skipped
 *      (strategicPriorities)
 *   3. live-value no-op (toValue materially equals current account value) →
 *      skipped (cogniriseHypothesis; sourceSignals URL already live)
 *   4. positive control — genuinely new values DO produce proposals, and
 *      re-feeding the builder its own output with the queue updated dedupes
 *
 * buildCartographerProposals is a pure function, so the probe constructs an
 * in-memory account row and CartographerOutput — no DB or LLM involved.
 * Run: pnpm exec tsx tests/crm/cartographer-proposal-dedupe-probe.ts
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
  const runner = await import("../../src/lib/atelier-agents/runner.js");
  const { buildCartographerProposals } = runner as unknown as {
    buildCartographerProposals: (args: {
      proposedBy: string;
      output: any;
      account: any;
      existingContacts: Array<{ fullName: string }>;
    }) => Array<{ field: string; toValue: unknown; status: string; expiresAt?: string }>;
  };

  const AGENT = "agent_account_cartographer";
  const now = new Date().toISOString();

  const LIVE_HYPO = "Cognirise can win by modernising their port logistics analytics stack";
  const NEW_HYPO = "Cognirise should lead with an AI-readiness assessment for the group CFO";
  const PENDING_HYPO = NEW_HYPO; // seeded as a pending proposal in case 1
  const REJECTED_PRIORITIES = ["Expand into Saudi Arabia", "Digitise customs clearance"];
  const NEW_PRIORITIES = ["Launch a green-corridor shipping initiative"];
  const LIVE_URL = "https://live.example.test/already-on-account";
  const NEW_URL = "https://fresh.example.test/new-signal";
  const PENDING_CONTACT = { fullName: "Salim Al Harthy", title: "Group CFO" };

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

  const liveSignal = { kind: "news", title: "Live", url: LIVE_URL };

  const baseAccount = {
    id: "acct_probe17",
    orgId: "aico",
    name: "Probe Seventeen Co",
    cogniriseHypothesis: LIVE_HYPO,
    strategicPriorities: ["Existing live priority"],
    researchBrief: null,
    sourceSignals: [liveSignal],
    pendingProfileUpdates: [] as unknown[],
  };

  const emptyBrief = {
    whatsChanging: [],
    executiveTensions: [],
    serviceLineFit: [],
    partnerEcosystem: [],
    mandateAngles: [],
    whyNowHypothesis: "",
    openQuestions: [],
  };

  const mkOutput = (over: Partial<Record<string, unknown>> = {}) => ({
    account: {
      refreshedSummary: "summary",
      strategicPriorities: [] as Array<{ text: string; sourceUrls: string[] }>,
      cogniriseHypothesis: "",
      ...(over.account as object | undefined),
    },
    sourceSignals: (over.sourceSignals as unknown[]) ?? [],
    decisionMakers: (over.decisionMakers as unknown[]) ?? [],
    researchBrief: over.researchBrief ?? emptyBrief,
  });

  const build = (account: any, output: any, existingContacts: Array<{ fullName: string }> = []) =>
    buildCartographerProposals({ proposedBy: AGENT, output, account, existingContacts });

  // --- Case 1: candidates matching existing PENDING proposals → skipped ---
  {
    const account = {
      ...baseAccount,
      pendingProfileUpdates: [
        mkProposal("cogniriseHypothesis", PENDING_HYPO, "pending"),
        mkProposal(
          "contact",
          { fullName: PENDING_CONTACT.fullName, title: PENDING_CONTACT.title },
          "pending",
        ),
      ],
    };
    const out = build(
      account,
      mkOutput({
        account: { cogniriseHypothesis: PENDING_HYPO },
        decisionMakers: [
          { fullName: PENDING_CONTACT.fullName, title: PENDING_CONTACT.title, confidence: "verified" },
        ],
      }),
    );
    check("pending hypothesis duplicate skipped", !out.some((p) => p.field === "cogniriseHypothesis"), out);
    check("pending contact duplicate skipped", !out.some((p) => p.field === "contact"), out);
    check("no stray proposals emitted (case 1)", out.length === 0, out);
  }

  // --- Case 2: candidate matching a REJECTED proposal → skipped ---
  {
    const account = {
      ...baseAccount,
      pendingProfileUpdates: [mkProposal("strategicPriorities", REJECTED_PRIORITIES, "rejected")],
    };
    const out = build(
      account,
      mkOutput({
        account: {
          strategicPriorities: REJECTED_PRIORITIES.map((text) => ({ text, sourceUrls: [] })),
        },
      }),
    );
    check("rejected strategicPriorities not resurfaced", out.length === 0, out);
  }

  // --- Case 3: live-value no-ops → skipped ---
  {
    const out = build(
      { ...baseAccount },
      mkOutput({
        // hypothesis identical to the live account value
        account: { cogniriseHypothesis: LIVE_HYPO },
        // signal URL already present on the account
        sourceSignals: [{ kind: "news", title: "Live again", url: LIVE_URL }],
      }),
    );
    check("live hypothesis no-op skipped", !out.some((p) => p.field === "cogniriseHypothesis"), out);
    check("already-live signal URL skipped", !out.some((p) => p.field === "sourceSignals"), out);
    check("no proposals at all for pure no-op run (case 3)", out.length === 0, out);
  }

  // --- Case 4: positive control — new values DO enqueue proposals ---
  {
    const output = mkOutput({
      account: {
        cogniriseHypothesis: NEW_HYPO,
        strategicPriorities: NEW_PRIORITIES.map((text) => ({ text, sourceUrls: [] })),
      },
      sourceSignals: [{ kind: "news", title: "Fresh", url: NEW_URL }],
      decisionMakers: [{ fullName: "Layla Al Busaidi", title: "CIO", confidence: "inferred" }],
    });
    const out = build({ ...baseAccount }, output);
    const fields = out.map((p) => p.field).sort();
    check(
      "positive control enqueues hypothesis/priorities/signals/contact",
      fields.join(",") === ["cogniriseHypothesis", "contact", "sourceSignals", "strategicPriorities"].sort().join(","),
      out,
    );
    check("all positive-control proposals are pending", out.every((p) => p.status === "pending"), out);
    check(
      "new proposals carry a future expiry",
      out.every((p) => !!p.expiresAt && Date.parse(p.expiresAt) > Date.now()),
      out,
    );

    // Re-run with those proposals now sitting in the queue as pending —
    // the identical output must produce zero new candidates.
    const accountAfter = { ...baseAccount, pendingProfileUpdates: out };
    const rerun = build(accountAfter, output);
    check("re-run against its own pending queue is fully deduped", rerun.length === 0, rerun);

    // And if the user rejects them all, they still must not resurface.
    const rejectedQueue = out.map((p) => ({ ...p, status: "rejected" }));
    const rerun2 = build({ ...baseAccount, pendingProfileUpdates: rejectedQueue }, output);
    check("re-run after rejection resurfaces nothing", rerun2.length === 0, rerun2);

    // An expired, never-decided proposal no longer blocks materially fresh
    // research. The replacement gets a new id/expiry and still requires review.
    const expiredQueue = out.map((p) => ({
      ...p,
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    }));
    const rerun3 = build({ ...baseAccount, pendingProfileUpdates: expiredQueue }, output);
    check("expired pending proposals can be refreshed", rerun3.length === out.length, rerun3);
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("probe crashed", e);
  process.exit(1);
});
