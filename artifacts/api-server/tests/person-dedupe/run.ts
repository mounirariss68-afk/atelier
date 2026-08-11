/**
 * pnpm --filter @workspace/api-server run test:person-dedupe
 *
 * Deterministic unit tests (no network, no DB, no LLM) for the shared fuzzy
 * person-identity matcher and the Executive Mapper proposal builder's
 * duplicate suppression. Locks in the edge cases that previously caused
 * duplicate people across the roster, proposal queue, and CRM contacts.
 */
import {
  personNameTokens,
  normalisePersonName,
  samePersonName,
  findPersonMatch,
  richerPersonName,
} from "../../src/lib/atelier-agents/person-name.js";
import {
  buildExecutiveMapperProposals,
  type ExecutiveMapperOutput,
  type PendingProfileUpdate,
} from "../../src/lib/atelier-agents/runner.js";

const failures: string[] = [];
function check(name: string, cond: unknown, detail?: string) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
    failures.push(name);
  }
}

// ---------------------------------------------------------------------------
console.log("personNameTokens / normalisePersonName");

check(
  "honorific Eng. stripped",
  normalisePersonName("Eng. Khalid AlFalih") === "khalid alfalih",
  normalisePersonName("Eng. Khalid AlFalih"),
);
check(
  "honorific Dr. stripped",
  normalisePersonName("Dr. Jane Doe") === "jane doe",
);
check(
  "stacked HE + Eng. stripped",
  normalisePersonName("HE Eng. Khalid Al-Falih") === "khalid alfalih",
  normalisePersonName("HE Eng. Khalid Al-Falih"),
);
check(
  "His Excellency phrase stripped",
  normalisePersonName("His Excellency Mohammed Al Jasser") === "mohammed aljasser",
  normalisePersonName("His Excellency Mohammed Al Jasser"),
);
check(
  "Al-Jasser hyphen fused",
  normalisePersonName("Mohammed Al-Jasser") === "mohammed aljasser",
);
check(
  "Al Jasser space fused",
  normalisePersonName("Mohammed Al Jasser") === "mohammed aljasser",
);
check(
  "AlJasser already fused",
  normalisePersonName("Mohammed AlJasser") === "mohammed aljasser",
);
check(
  "diacritics stripped",
  normalisePersonName("José García") === "jose garcia",
  normalisePersonName("José García"),
);
check(
  "trailing company after spaced hyphen cut",
  normalisePersonName("Jane Doe - Acme Corp") === "jane doe",
);
check(
  "trailing ' | LinkedIn' cut",
  normalisePersonName("Jane Doe | LinkedIn") === "jane doe",
);
check(
  "trailing parenthetical cut",
  normalisePersonName("Jane Doe (Acme)") === "jane doe",
);
check(
  "trailing ', CFA' cut",
  normalisePersonName("Jane Doe, CFA") === "jane doe",
);
check(
  "intra-name hyphen without spaces preserved as fused token",
  normalisePersonName("Khalid Al-Falih") === "khalid alfalih",
);
check(
  "bin particle dropped",
  personNameTokens("Mohammed bin Nasser Al-Jasser").join(" ") ===
    "mohammed nasser aljasser",
  personNameTokens("Mohammed bin Nasser Al-Jasser").join(" "),
);
check("empty name -> no tokens", personNameTokens("   ").length === 0);

// ---------------------------------------------------------------------------
console.log("samePersonName — matches");

const shouldMatch: Array<[string, string]> = [
  ["Mohammed Al-Jasser", "Mohammed Al Jasser"],
  ["Mohammed Al Jasser", "Mohammed AlJasser"],
  ["Eng. Khalid AlFalih", "Khalid Al-Falih"],
  ["HE Dr. Mohammed Al Jasser", "Mohammed Al-Jasser"],
  ["Mohammed Al Jasser", "Mohammed bin Nasser Al-Jasser"], // patronymic subset
  ["Mohammed bin Nasser Al-Jasser", "Mohammed Al Jasser"], // symmetric
  ["José García", "Jose Garcia"],
  ["Jane Doe - Acme Corp", "Jane Doe"],
  ["Jane Doe | LinkedIn", "Jane Doe, CFA"],
  ["Sheikh Ahmed bin Saeed Al Maktoum", "Ahmed Al-Maktoum"],
];
for (const [a, b] of shouldMatch) {
  check(`match: "${a}" == "${b}"`, samePersonName(a, b));
}

console.log("samePersonName — near-misses that must NOT match");

const mustNotMatch: Array<[string, string]> = [
  ["Mohammed Al Jasser", "Mohammed Al Nasser"], // different surname
  ["Mohammed Al Jasser", "Ahmed Al Jasser"], // different first name
  ["Mohammed Al Jasser", "Mohammed Nasser Al-Otaibi"], // different last token
  ["Jane Doe", "Jane Dole"],
  ["Khalid Al-Falih", "Khalid Al-Faleh"], // one-letter surname variant
  ["Ali Hassan", "Ali Hassan Kamel"], // subset but last tokens differ
  ["Mohammed", "Mohammed Al Jasser"], // single token too weak
  ["", "Jane Doe"],
  ["Dr.", "Jane Doe"], // honorific-only collapses to empty
];
for (const [a, b] of mustNotMatch) {
  check(`no match: "${a}" != "${b}"`, !samePersonName(a, b));
}

// ---------------------------------------------------------------------------
console.log("findPersonMatch");

{
  const entries = [
    { fullName: "Ali Hassan Kamel" },
    { fullName: "Ali Hassan" },
  ];
  const hit = findPersonMatch("Ali Hassan", entries, (e) => e.fullName);
  check(
    "exact normalised match preferred over subset",
    hit?.fullName === "Ali Hassan",
    hit?.fullName,
  );
}
{
  const entries = [{ fullName: "Mohammed bin Nasser Al-Jasser" }];
  const hit = findPersonMatch("Mohammed Al Jasser", entries, (e) => e.fullName);
  check("fuzzy subset match found", hit?.fullName === "Mohammed bin Nasser Al-Jasser");
}
{
  const entries = [{ fullName: "Ahmed Al Jasser" }];
  const hit = findPersonMatch("Mohammed Al Jasser", entries, (e) => e.fullName);
  check("no false positive on different first name", hit === undefined);
}
{
  const hit = findPersonMatch("  ", [{ fullName: "Jane Doe" }], (e) => e.fullName);
  check("blank query returns undefined", hit === undefined);
}

// ---------------------------------------------------------------------------
console.log("richerPersonName");

check(
  "more tokens wins",
  richerPersonName("Mohammed Al Jasser", "Mohammed bin Nasser Al-Jasser") ===
    "Mohammed bin Nasser Al-Jasser",
);
check(
  "more tokens wins (args swapped)",
  richerPersonName("Mohammed bin Nasser Al-Jasser", "Mohammed Al Jasser") ===
    "Mohammed bin Nasser Al-Jasser",
);
check(
  "equal tokens -> longer string wins",
  richerPersonName("Jo Doe", "Joanna Doe") === "Joanna Doe",
);
check(
  "tie -> first argument kept",
  richerPersonName("Jane Doe", "Jane Do") === "Jane Doe",
);

// ---------------------------------------------------------------------------
console.log("buildExecutiveMapperProposals — duplicate suppression");

type DM = ExecutiveMapperOutput["decisionMakers"][number];

function dm(partial: Partial<DM> & { fullName: string }): DM {
  return {
    title: null,
    entityName: null,
    entityScope: null,
    seniority: null,
    buyerPersona: null,
    sourceUrl: null,
    linkedinUrl: null,
    confidence: "inferred",
    reportsToName: null,
    rationale: null,
    ...partial,
  } as DM;
}

function makeAccount(pending: PendingProfileUpdate[] = []) {
  return { pendingProfileUpdates: pending } as unknown as Parameters<
    typeof buildExecutiveMapperProposals
  >[0]["account"];
}

function build(
  dms: DM[],
  existingContacts: Array<{
    fullName: string;
    title: string | null;
    linkedinUrl: string | null;
  }> = [],
  pending: PendingProfileUpdate[] = [],
) {
  return buildExecutiveMapperProposals({
    output: { decisionMakers: dms, sourceSignals: [], openQuestions: [] },
    account: makeAccount(pending),
    existingContacts,
  });
}

// 1) Intra-roster duplicates: two spellings of one human -> one proposal.
{
  const out = build([
    dm({ fullName: "Mohammed Al-Jasser", title: "CEO" }),
    dm({ fullName: "Mohammed Al Jasser", title: "Chief Executive Officer" }),
    dm({ fullName: "HE Mohammed AlJasser", title: "CEO" }),
  ]);
  check("intra-roster dupes collapse to one proposal", out.length === 1, String(out.length));
  check(
    "first spelling kept for new person",
    (out[0]?.toValue as { fullName?: string })?.fullName === "Mohammed Al-Jasser",
    JSON.stringify(out[0]?.toValue),
  );
}

// 2) Known contact with nothing new -> dropped entirely.
{
  const out = build(
    [dm({ fullName: "Mohammed Al Jasser", title: "CEO" })],
    [{ fullName: "Mohammed Al-Jasser", title: "CEO", linkedinUrl: "https://li/x" }],
  );
  check("known contact with nothing new is dropped", out.length === 0, String(out.length));
}

// 3) Fuzzy-matched existing contact + new LinkedIn -> enrich, not duplicate,
//    and richer spelling proposed.
{
  const out = build(
    [
      dm({
        fullName: "Mohammed bin Nasser Al-Jasser",
        title: "CEO",
        linkedinUrl: "https://linkedin.com/in/maj",
      }),
    ],
    [{ fullName: "Mohammed Al Jasser", title: "CEO", linkedinUrl: null }],
  );
  check("enrich proposal produced", out.length === 1, String(out.length));
  const tv = out[0]?.toValue as { fullName?: string; linkedinUrl?: string | null };
  check(
    "richer spelling proposed for existing contact",
    tv?.fullName === "Mohammed bin Nasser Al-Jasser",
    tv?.fullName,
  );
  check("linkedin carried on enrich", tv?.linkedinUrl === "https://linkedin.com/in/maj");
  check(
    "rationale describes enrichment not discovery",
    /LinkedIn profile for existing contact/.test(out[0]?.rationale ?? ""),
    out[0]?.rationale,
  );
}

// 4) Existing contact, richer spelling already in CRM -> CRM spelling kept.
{
  const out = build(
    [dm({ fullName: "Mohammed Al Jasser", title: "Group CEO" })],
    [{ fullName: "Mohammed bin Nasser Al-Jasser", title: "CEO", linkedinUrl: "https://li/x" }],
  );
  check("title change proposal produced", out.length === 1, String(out.length));
  check(
    "existing richer CRM spelling kept",
    (out[0]?.toValue as { fullName?: string })?.fullName ===
      "Mohammed bin Nasser Al-Jasser",
    JSON.stringify(out[0]?.toValue),
  );
}

// 5) Second spelling of an already-known (skipped) person can't sneak through.
{
  const out = build(
    [
      dm({ fullName: "Mohammed Al Jasser", title: "CEO" }), // known, nothing new -> skipped
      dm({ fullName: "Mohammed Al-Jasser", title: "Chief Executive" }), // 2nd spelling
    ],
    [{ fullName: "Mohammed Al Jasser", title: "CEO", linkedinUrl: "https://li/x" }],
  );
  check(
    "second spelling of skipped person is suppressed",
    out.length === 0,
    String(out.length),
  );
}

// 6) Near-miss names remain independent proposals.
{
  const out = build([
    dm({ fullName: "Mohammed Al Jasser", title: "CEO" }),
    dm({ fullName: "Ahmed Al Jasser", title: "CFO" }),
  ]);
  check("near-miss names produce separate proposals", out.length === 2, String(out.length));
}

// 7) Pending/rejected queue entries block re-proposal (same name+title key).
{
  const pending: PendingProfileUpdate[] = [
    {
      id: "pp_x1",
      proposedBy: "ag_executive_mapper",
      proposedAt: new Date().toISOString(),
      field: "contact",
      fromValue: null,
      toValue: { fullName: "Jane Doe", title: "CFO" },
      rationale: "prior",
      status: "rejected",
    } as unknown as PendingProfileUpdate,
  ];
  const out = build([dm({ fullName: "Jane Doe", title: "CFO" })], [], pending);
  check("rejected queue entry blocks identical proposal", out.length === 0, String(out.length));
}

// 7b) Rerun with a fuzzy spelling variant of a PENDING proposal -> blocked
//     outright (one proposal per human until the queue entry is resolved).
{
  const pending: PendingProfileUpdate[] = [
    {
      id: "pp_x2",
      proposedBy: "ag_executive_mapper",
      proposedAt: new Date().toISOString(),
      field: "contact",
      fromValue: null,
      toValue: { fullName: "Mohammed bin Nasser Al-Jasser", title: "CEO" },
      rationale: "prior run",
      status: "pending",
    } as unknown as PendingProfileUpdate,
  ];
  const out = build(
    [dm({ fullName: "Mohammed Al Jasser", title: "Group Chief Executive" })],
    [],
    pending,
  );
  check(
    "pending proposal blocks fuzzy spelling variant on rerun",
    out.length === 0,
    String(out.length),
  );
}

// 7c) REJECTED proposal blocks a fuzzy variant with the same title, but a
//     genuinely different title may be re-proposed.
{
  const rejected: PendingProfileUpdate[] = [
    {
      id: "pp_x3",
      proposedBy: "ag_executive_mapper",
      proposedAt: new Date().toISOString(),
      field: "contact",
      fromValue: null,
      toValue: { fullName: "Mohammed bin Nasser Al-Jasser", title: "CEO" },
      rationale: "prior run",
      status: "rejected",
    } as unknown as PendingProfileUpdate,
  ];
  const sameTitle = build([dm({ fullName: "Mohammed Al Jasser", title: "ceo" })], [], rejected);
  check(
    "rejected proposal blocks fuzzy variant with same title",
    sameTitle.length === 0,
    String(sameTitle.length),
  );
  const noTitle = build([dm({ fullName: "Mohammed Al Jasser", title: null as unknown as string })], [], rejected);
  check(
    "rejected proposal blocks fuzzy variant with no title info",
    noTitle.length === 0,
    String(noTitle.length),
  );
  const newTitle = build(
    [dm({ fullName: "Mohammed Al Jasser", title: "Chairman of the Board" })],
    [],
    rejected,
  );
  check(
    "rejected proposal does NOT block a genuinely new title",
    newTitle.length === 1,
    String(newTitle.length),
  );
}

// 9) Initials + transliteration variants (review-mandated cases).
console.log("samePersonName — initials & transliteration");
check(
  "initial matches expanded given name",
  samePersonName("M. Al Jasser", "Mohammed Al Jasser"),
);
check(
  "initial without dot matches too",
  samePersonName("M Al-Jasser", "Mohammed Al Jasser"),
);
check(
  "initial does NOT satisfy the surname",
  !samePersonName("Mohammed J.", "Mohammed Al Jasser"),
);
check(
  "Mohammad / Mohammed / Muhammad fold together",
  samePersonName("Mohammad Al Jasser", "Mohammed Al Jasser") &&
    samePersonName("Muhammad Al Jasser", "Mohammed Al Jasser"),
);
check(
  "Hussain / Hussein fold together",
  samePersonName("Hussain Al Nowais", "Hussein Al Nowais"),
);
check(
  "Khaled / Khalid fold together",
  samePersonName("Khaled Al-Falih", "Khalid AlFalih"),
);
check(
  "Yousef / Yusuf fold together",
  samePersonName("Yousef Al Otaiba", "Yusuf Al-Otaiba"),
);
check(
  "transliterated surname folds too",
  samePersonName("Ali Al-Rasheed", "Ali Al Rashid"),
);
check(
  "Hassan vs Hussein stay distinct",
  !samePersonName("Hassan Al Nowais", "Hussein Al Nowais"),
);
check(
  "different surnames never match on shared initial",
  !samePersonName("M. Al Jasser", "Mohammed Al Mansoori"),
);

// 9b) Proposal-path: initial/transliteration variant of a pending proposal
//     is blocked, and enriches (not duplicates) an existing CRM contact.
{
  const pending: PendingProfileUpdate[] = [
    {
      id: "pp_x4",
      proposedBy: "ag_executive_mapper",
      proposedAt: new Date().toISOString(),
      field: "contact",
      fromValue: null,
      toValue: { fullName: "Mohammed Al Jasser", title: "CEO" },
      rationale: "prior run",
      status: "pending",
    } as unknown as PendingProfileUpdate,
  ];
  const out = build([dm({ fullName: "M. Al-Jasser", title: "CEO" })], [], pending);
  check("initial variant blocked by pending proposal", out.length === 0, String(out.length));

  const out2 = build(
    [dm({ fullName: "Muhammad Al Jasser", title: "CEO", linkedinUrl: "https://li/maj" })],
    [{ fullName: "Mohammed Al-Jasser", title: "CEO", linkedinUrl: null }],
  );
  check("transliteration variant enriches existing contact", out2.length === 1, String(out2.length));
  check(
    "no discovery proposal for transliteration variant",
    /existing contact/.test(out2[0]?.rationale ?? ""),
    out2[0]?.rationale,
  );
}

// 10) Task #958 — name-order swaps, near-miss spelling fallback, and
//     enrichment labeling.
console.log("samePersonName — name-order swaps");
check(
  "order swap matches",
  samePersonName("AlSaghir Hamad", "Hamad Al-Saghir"),
);
check(
  "order swap with transliteration matches",
  samePersonName("Al Jasser Mohammad", "Mohammed Al-Jasser"),
);
check(
  "reordered but different token sets do NOT match",
  !samePersonName("Nasser Mohammed", "Mohammed Al Jasser"),
);
check(
  "swap never widens to initials",
  !samePersonName("J. Mohammed", "Mohammed Al Jasser"),
);

{
  // Within-run: an order-swapped second sighting collapses to one proposal.
  const out = build([
    dm({ fullName: "Hamad AlSaghir", title: "CFO" }),
    dm({ fullName: "Al-Saghir Hamad", title: "Chief Financial Officer" }),
  ]);
  check("order-swapped within-run dupe suppressed", out.length === 1, String(out.length));
}
{
  // Existing contact under an order-swapped spelling, nothing new -> dropped.
  const out = build(
    [dm({ fullName: "Al-Saghir Hamad", title: "CFO" })],
    [{ fullName: "Hamad AlSaghir", title: "CFO", linkedinUrl: "https://li/h" }],
  );
  check("order-swapped known contact with nothing new dropped", out.length === 0, String(out.length));
}
{
  // Near-miss spelling the structural matcher can't see is caught by the
  // shared contact-duplicate scorer (high confidence only).
  const out = build(
    [dm({ fullName: "Khalid Al-Faleh", title: "CEO" })],
    [{ fullName: "Khalid Al-Falih", title: "CEO", linkedinUrl: "https://li/k" }],
  );
  check("high-confidence near-miss spelling dropped when nothing new", out.length === 0, String(out.length));
}
{
  // Enrichment proposals are labeled as updates to an existing contact; new
  // people are labeled new.
  const out = build(
    [
      dm({ fullName: "Hamad Al-Saghir", title: "CFO", linkedinUrl: "https://li/h" }),
      dm({ fullName: "Jane Doe", title: "CTO" }),
    ],
    [{ fullName: "Hamad AlSaghir", title: "CFO", linkedinUrl: null }],
  );
  check("enrichment + new person both proposed", out.length === 2, String(out.length));
  const enrich = out.find(
    (p) => (p.meta as { updateKind?: string })?.updateKind === "enrichment",
  );
  const fresh = out.find(
    (p) => (p.meta as { updateKind?: string })?.updateKind === "new_contact",
  );
  check("enrichment proposal carries updateKind=enrichment", Boolean(enrich));
  check(
    "enrichment proposal names the existing contact",
    (enrich?.meta as { existingContactName?: string })?.existingContactName ===
      "Hamad AlSaghir",
    JSON.stringify(enrich?.meta),
  );
  check("new person carries updateKind=new_contact", Boolean(fresh));
  check(
    "two same-run proposals never target the same person",
    out.filter((p) =>
      samePersonName(
        (p.toValue as { fullName: string }).fullName,
        "Hamad AlSaghir",
      ),
    ).length === 1,
  );
}

// 8) Blank names skipped.
{
  const out = build([dm({ fullName: "   " }), dm({ fullName: "Jane Doe", title: "CFO" })]);
  check("blank decision-maker names skipped", out.length === 1, String(out.length));
}

// ---------------------------------------------------------------------------
if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nAll person-dedupe checks passed.");
