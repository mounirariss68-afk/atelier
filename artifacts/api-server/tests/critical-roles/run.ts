/**
 * pnpm --filter @workspace/api-server run test:critical-roles
 *
 * Unit tests for the Executive Mapper critical-role taxonomy (Task #206):
 *  1. classifyCriticalRole — title variants map to the right role id;
 *     junior/adjacent titles and ambiguous acronyms map to nothing.
 *  2. guardExecutiveMapperCriticalRoles — model claims are overwritten from
 *     the verbatim title, juniors are dropped (logged), coverage is
 *     code-computed and unfound roles land in openQuestions.
 *  3. buildExecutiveMapperProposals — criticalRole rides into toValue; a
 *     newly-determined tag re-lists a known contact, but an unchanged title
 *     (same classification) does not (loop-safe).
 */
import {
  classifyCriticalRole,
  titleSeniorityRank,
  guardExecutiveMapperCriticalRoles,
  computeCriticalRoleCoverage,
  CRITICAL_ROLES,
  UNFOUND_ROLES_MARKER,
  type CriticalRoleId,
} from "../../src/lib/atelier-agents/critical-roles.js";
import {
  buildExecutiveMapperProposals,
  type ExecutiveMapperOutput,
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

// ---------- 1) classifier: positive variants ----------
console.log("\nclassifier — positive variants");
const positives: Array<[string, CriticalRoleId]> = [
  ["Chief Executive Officer", "ceo"],
  ["Group CEO", "ceo"],
  ["CFO", "cfo"],
  ["Group Chief Financial Officer", "cfo"],
  ["Chief Operating Officer", "coo"],
  ["Group CTO", "cto"],
  ["Chief Technology Officer", "cto"],
  ["Chief Information Officer", "cio"],
  ["Global CIO", "cio"],
  ["Chief Data Officer", "cdo"],
  ["Chief Digital Officer", "cdo"],
  ["Chief Data & Analytics Officer", "cdo"],
  ["Chief AI Officer", "caio"],
  ["Chief Artificial Intelligence Officer", "caio"],
  ["Head of AI", "head_of_ai"],
  ["SVP & Head of Artificial Intelligence", "head_of_ai"],
  ["VP AI", "head_of_ai"],
  ["Head of Machine Learning", "head_of_ai"],
  ["Chief Marketing Officer", "cmo"],
  ["Head of Marketing", "cmo"],
  ["SVP Marketing", "cmo"],
  ["Chief Product Officer", "cpo_product"],
  ["Head of Product", "cpo_product"],
  ["VP Product", "cpo_product"],
  ["Chief Commercial Officer", "cco_commercial"],
  ["Head of Commercial", "cco_commercial"],
  ["Chief Procurement Officer", "cpo_procurement"],
  ["Head of Procurement", "cpo_procurement"],
  ["Procurement Director", "cpo_procurement"],
  ["Head of Supply Chain", "cpo_procurement"],
  ["Head of Transformation", "head_of_transformation"],
  ["EVP Digital Transformation", "head_of_transformation"],
  ["Chief Transformation Officer", "head_of_transformation"],
  ["Transformation Director", "head_of_transformation"],
  ["Head of PMO", "head_of_pmo"],
  ["Head of Programme Management Office", "head_of_pmo"],
  ["Head of VRO", "head_of_vro"],
  ["VP Value Realization Office", "head_of_vro"],
  ["Head of Value Realisation", "head_of_vro"],
];
for (const [title, expected] of positives) {
  const got = classifyCriticalRole(title);
  check(`"${title}" → ${expected}`, got === expected, `got ${got}`);
}

// ---------- 2) classifier: near-misses and juniors never match ----------
console.log("\nclassifier — near-misses / anti-junior");
const negatives: string[] = [
  "AI Engineer",
  "Marketing Manager",
  "IT Director", // generic tech director is NOT the CIO
  "Chief Investment Officer", // not CIO (information)
  "Chief Diversity Officer", // not CDO (data/digital)
  "Chief Communications Officer", // not CCO (commercial)
  "Chief Compliance Officer",
  "Production Manager",
  "Product Manager",
  "Senior Data Analyst",
  "Digital Marketing Specialist",
  "Deputy CEO", // deputy is not the holder
  "Assistant to the CFO",
  "Transformation Lead", // below floor
  "Supply Chain Manager",
];
for (const title of negatives) {
  const got = classifyCriticalRole(title);
  check(`"${title}" → null`, got === null, `got ${got}`);
}
check(
  `"VP Product Marketing" is marketing, not product`,
  classifyCriticalRole("VP Product Marketing") === "cmo",
  String(classifyCriticalRole("VP Product Marketing")),
);
check(
  `"Chairman of the Board" → no critical role (board handled separately)`,
  classifyCriticalRole("Chairman of the Board") === null,
);

// ---------- 3) seniority ranks ----------
console.log("\ntitle seniority ranks");
check("chief → 5", titleSeniorityRank("Chief Data Officer") === 5);
check("SVP → 4", titleSeniorityRank("SVP Marketing") === 4);
check("Head of → 3", titleSeniorityRank("Head of Product") === 3);
check("Director → 2", titleSeniorityRank("IT Director") === 2);
check("Manager → 1", titleSeniorityRank("Marketing Manager") === 1);
check("Engineer → 0", titleSeniorityRank("AI Engineer") === 0);
check("empty → -1", titleSeniorityRank("") === -1);

// ---------- 4) guard: overwrite claims, drop juniors, compute coverage ----
console.log("\nguardExecutiveMapperCriticalRoles");
type Dm = ExecutiveMapperOutput["decisionMakers"][number];
const dm = (over: Partial<Dm>): Dm =>
  ({
    fullName: "Person X",
    title: null,
    entityName: null,
    entityScope: null,
    seniority: undefined,
    buyerPersona: undefined,
    sourceUrl: null,
    linkedinUrl: null,
    confidence: "verified",
    reportsToName: null,
    rationale: undefined,
    criticalRole: null,
    timeInRole: null,
    careerHistory: [],
    education: [],
    ...over,
  }) as Dm;

const out: ExecutiveMapperOutput = {
  decisionMakers: [
    // Hallucinated claim: model says the engineer is head_of_ai → must be
    // nulled AND the person dropped as IC.
    dm({ fullName: "Junior Engineer", title: "AI Engineer", criticalRole: "head_of_ai" }),
    // Hallucinated claim on a kept person: marketing chief claimed as ceo →
    // corrected to cmo from the verbatim title.
    dm({ fullName: "Mona Marketer", title: "Chief Marketing Officer", criticalRole: "ceo" }),
    // No claim, title supports a role → tag added deterministically.
    dm({ fullName: "Tariq Tech", title: "Group CTO", criticalRole: null }),
    // Generic director, no critical-role function → dropped.
    dm({ fullName: "Iman IT", title: "IT Director" }),
    // Director WITH a critical-role function → kept.
    dm({ fullName: "Paula Procure", title: "Procurement Director" }),
    // Declared manager seniority → dropped regardless of title.
    dm({ fullName: "Sam Manager", title: "Head of Product", seniority: "manager" }),
    // Board member with a junior-looking day title → always kept.
    dm({ fullName: "Basma Board", title: "Board Member", seniority: "board_member" }),
    // Chief of staff — no critical role, but senior → kept, untagged.
    dm({ fullName: "Chris Staff", title: "Chief of Staff" }),
  ],
  sourceSignals: [],
  openQuestions: [],
};
guardExecutiveMapperCriticalRoles(out);
const names = out.decisionMakers.map((d) => d.fullName);
check("engineer dropped", !names.includes("Junior Engineer"), names.join(", "));
check("IT Director dropped", !names.includes("Iman IT"));
check("declared manager dropped", !names.includes("Sam Manager"));
check("procurement director kept", names.includes("Paula Procure"));
check("board member kept", names.includes("Basma Board"));
check("chief of staff kept untagged", out.decisionMakers.find((d) => d.fullName === "Chris Staff")?.criticalRole === null);
check(
  "hallucinated ceo claim corrected to cmo",
  out.decisionMakers.find((d) => d.fullName === "Mona Marketer")?.criticalRole === "cmo",
);
check(
  "missing claim backfilled to cto",
  out.decisionMakers.find((d) => d.fullName === "Tariq Tech")?.criticalRole === "cto",
);
check(
  "drops are logged with reasons",
  (out.droppedBySeniorityGuard ?? []).length === 3 &&
    (out.droppedBySeniorityGuard ?? []).every((d) => d.reason.length > 0),
  JSON.stringify(out.droppedBySeniorityGuard),
);
const cov = out.criticalRoleCoverage ?? [];
check("coverage has all 15 roles", cov.length === CRITICAL_ROLES.length, String(cov.length));
check(
  "cmo/cto/cpo_procurement found in coverage",
  cov.find((c) => c.role === "cmo")?.found === true &&
    cov.find((c) => c.role === "cto")?.found === true &&
    cov.find((c) => c.role === "cpo_procurement")?.found === true,
);
check(
  "head_of_ai NOT covered by the dropped engineer",
  cov.find((c) => c.role === "head_of_ai")?.found === false,
);
check(
  "unfound roles recorded in openQuestions",
  out.openQuestions.some((q) => q.includes(UNFOUND_ROLES_MARKER)),
  out.openQuestions.join(" | "),
);

// verified preferred over inferred in coverage
{
  const covPref = computeCriticalRoleCoverage([
    { fullName: "Inferred CFO", title: "CFO", confidence: "inferred", criticalRole: "cfo" },
    { fullName: "Verified CFO", title: "Group CFO", confidence: "verified", criticalRole: "cfo" },
  ]);
  check(
    "coverage prefers verified holder",
    covPref.find((c) => c.role === "cfo")?.personName === "Verified CFO",
  );
}

// ---------- 5) proposal builder carries the tag / re-list rules ----------
console.log("\nbuildExecutiveMapperProposals");
const account = {
  pendingProfileUpdates: [],
} as unknown as Parameters<typeof buildExecutiveMapperProposals>[0]["account"];

// New person: tag rides in toValue.
{
  const proposals = buildExecutiveMapperProposals({
    output: {
      decisionMakers: [dm({ fullName: "Nadia New", title: "Chief Data Officer", criticalRole: "cdo" })],
      sourceSignals: [],
      openQuestions: [],
    },
    account,
    existingContacts: [],
  });
  check("new person proposed", proposals.length === 1, String(proposals.length));
  check(
    "criticalRole rides in toValue",
    (proposals[0]?.toValue as { criticalRole?: string })?.criticalRole === "cdo",
  );
}

// Known contact, same title (same classification) → NOT re-listed.
{
  const proposals = buildExecutiveMapperProposals({
    output: {
      decisionMakers: [dm({ fullName: "Karim Known", title: "Group CTO", criticalRole: "cto" })],
      sourceSignals: [],
      openQuestions: [],
    },
    account,
    existingContacts: [{ fullName: "Karim Known", title: "Group CTO", linkedinUrl: "https://www.linkedin.com/in/karim" }],
  });
  check("known contact with same title not re-listed", proposals.length === 0, String(proposals.length));
}

// Known contact whose stored title doesn't classify to the new tag → re-listed.
{
  const proposals = buildExecutiveMapperProposals({
    output: {
      decisionMakers: [
        dm({ fullName: "Lina Lift", title: "Chief Transformation Officer", criticalRole: "head_of_transformation" }),
      ],
      sourceSignals: [],
      openQuestions: [],
    },
    account,
    existingContacts: [
      // Stored title classifies to nothing; the sighting carries a tag AND a
      // changed title — new information, re-list.
      { fullName: "Lina Lift", title: "Strategy Advisor", linkedinUrl: "https://www.linkedin.com/in/lina" },
    ],
  });
  check("new critical-role determination re-lists known contact", proposals.length === 1, String(proposals.length));
  check(
    "re-listed proposal carries the tag",
    (proposals[0]?.toValue as { criticalRole?: string })?.criticalRole === "head_of_transformation",
  );
  // Task #972 — enrichment snapshots the CURRENT contact values in fromValue
  // so the review card can render a before → after diff.
  const from = proposals[0]?.fromValue as {
    fullName?: string;
    title?: string | null;
    linkedinUrl?: string | null;
    criticalRole?: string | null;
  } | null;
  check("enrichment fromValue carries current title", from?.title === "Strategy Advisor");
  check(
    "enrichment fromValue carries current linkedin",
    from?.linkedinUrl === "https://www.linkedin.com/in/lina",
  );
  check("enrichment fromValue carries current role classification", from?.criticalRole === null);
}

// New-contact proposals keep fromValue null (unchanged card).
{
  const proposals = buildExecutiveMapperProposals({
    output: {
      decisionMakers: [dm({ fullName: "Farah Fresh", title: "Group CIO", criticalRole: "cio" })],
      sourceSignals: [],
      openQuestions: [],
    },
    account,
    existingContacts: [],
  });
  check("new-contact fromValue stays null", proposals[0]?.fromValue === null);
}

console.log("");
if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("All critical-role checks passed.");
