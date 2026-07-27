/**
 * Deterministic probe for the government-title layer of the Executive Mapper
 * critical-roles guard (GCC + Türkiye ministry hierarchies). Pure functions —
 * no DB, no network, no LLM.
 *
 * Run: npx tsx tests/crm/gov-titles-probe.ts
 */
import {
  classifyCriticalRole,
  guardExecutiveMapperCriticalRoles,
  governmentTitleSeniorityRank,
  isGovernmentAccount,
  titleSeniorityRank,
} from "../../src/lib/atelier-agents/critical-roles.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.error(`  FAIL ${name}`, detail ?? "");
  }
}

console.log("[1] isGovernmentAccount detection");
check("sector 'Government'", isGovernmentAccount({ sector: "Government", name: "X" }));
check("sector 'Public Sector'", isGovernmentAccount({ sector: "Public Sector", name: "X" }));
check(
  "name 'Ministry of Finance'",
  isGovernmentAccount({ sector: "Financial Services", name: "Ministry of Finance" }),
);
check(
  "name 'Dubai Municipality'",
  isGovernmentAccount({ sector: null, name: "Dubai Municipality" }),
);
check(
  "Turkish 'Hazine ve Maliye Bakanlığı'",
  isGovernmentAccount({ sector: null, name: "Hazine ve Maliye Bakanlığı" }),
);
check(
  "'Saudi Central Bank'",
  isGovernmentAccount({ sector: "Banking", name: "Saudi Central Bank" }),
);
check(
  "'Communications and Information Technology Commission'",
  isGovernmentAccount({ sector: null, name: "Communications and Information Technology Commission" }),
);
check("private co NOT gov", !isGovernmentAccount({ sector: "Retail", name: "Alshaya Group" }));
check("bank NOT gov", !isGovernmentAccount({ sector: "Banking", name: "Emirates NBD" }));

console.log("[2] governmentTitleSeniorityRank");
const govRanks: Array<[string, number]> = [
  ["Minister of Finance", 5],
  ["Minister of State for Artificial Intelligence", 5],
  ["Bakan", 5],
  ["Governor", 5],
  ["Governor of the Saudi Central Bank", 5],
  ["Vali", 5],
  ["Secretary General of the Supreme Council", 5],
  ["Vice Minister", 4],
  ["Deputy Minister for Digital Transformation", 4],
  ["Assistant Minister of Executive Affairs", 4],
  ["Bakan Yardımcısı", 4],
  ["Undersecretary", 4],
  ["Müsteşar", 4],
  ["Deputy Governor", 4],
  ["Director General of Information Technology", 4],
  ["Genel Müdür", 4],
  ["Assistant Undersecretary for Planning", 3],
  ["Deputy Director General", 3],
  ["Genel Müdür Yardımcısı", 3],
  ["Daire Başkanı", 3],
  ["Executive Director of Digital Sector", 3],
  // vetoed / unrecognised
  ["Advisor to the Minister", -1],
  ["Assistant to the Deputy Minister", -1],
  ["Office of the Minister", -1],
  ["Spokesperson", -1],
  ["Software Engineer", -1],
];
for (const [title, want] of govRanks) {
  const got = governmentTitleSeniorityRank(title);
  check(`"${title}" → ${want}`, got === want, `got ${got}`);
}

console.log("[3] titleSeniorityRank gov mode vs default");
check(
  "Deputy Minister default rank unranked",
  titleSeniorityRank("Deputy Minister of Health") === -1,
);
check(
  "Deputy Minister gov rank 4",
  titleSeniorityRank("Deputy Minister of Health", { government: true }) === 4,
);
check(
  "Director General gov rank 4 (not corporate director 2)",
  titleSeniorityRank("Director General", { government: true }) === 4,
);
check(
  "corporate CEO unchanged in gov mode",
  titleSeniorityRank("Chief Executive Officer", { government: true }) === 5,
);
check(
  "corporate CEO default unchanged",
  titleSeniorityRank("Chief Executive Officer") === 5,
);

console.log("[4] classifyCriticalRole gov mode");
check(
  "Deputy Minister for Digital Transformation → head_of_transformation (gov)",
  classifyCriticalRole("Deputy Minister for Digital Transformation", { government: true }) ===
    "head_of_transformation",
);
check(
  "same title default mode → null (deputy veto)",
  classifyCriticalRole("Deputy Minister for Digital Transformation") === null,
);
check(
  "Undersecretary for Artificial Intelligence → head_of_ai (gov)",
  classifyCriticalRole("Undersecretary for Artificial Intelligence", { government: true }) ===
    "head_of_ai",
);
check(
  "Advisor to the Minister for AI → null even in gov mode",
  classifyCriticalRole("Advisor to the Minister for Artificial Intelligence", {
    government: true,
  }) === null,
);
check(
  "corporate CTO unchanged in gov mode",
  classifyCriticalRole("Chief Technology Officer", { government: true }) === "cto",
);

console.log("[5] guardExecutiveMapperCriticalRoles gov mode keeps ministry ranks");
const output = {
  decisionMakers: [
    { fullName: "A Minister", title: "Minister of Finance", confidence: "verified" as const },
    {
      fullName: "B Deputy",
      title: "Deputy Minister for Digital Transformation",
      confidence: "verified" as const,
    },
    { fullName: "C Wakil", title: "Undersecretary", confidence: "inferred" as const },
    { fullName: "D DG", title: "Genel Müdür", confidence: "inferred" as const },
    { fullName: "E Aide", title: "Advisor to the Minister", confidence: "inferred" as const },
    { fullName: "F Junior", title: "Senior Analyst", confidence: "inferred" as const },
  ],
  openQuestions: [] as string[],
};
guardExecutiveMapperCriticalRoles(output, { government: true });
const keptNames = output.decisionMakers.map((d) => d.fullName);
check(
  "kept minister/deputy/undersecretary/genel müdür",
  ["A Minister", "B Deputy", "C Wakil", "D DG"].every((n) => keptNames.includes(n)),
  keptNames,
);
check(
  "dropped advisor + analyst",
  !keptNames.includes("E Aide") && !keptNames.includes("F Junior"),
  keptNames,
);
check(
  "deputy tagged head_of_transformation",
  (output.decisionMakers.find((d) => d.fullName === "B Deputy") as { criticalRole?: string })
    ?.criticalRole === "head_of_transformation",
);

console.log("[6] default-mode guard unchanged (regression)");
const corp = {
  decisionMakers: [
    { fullName: "G CEO", title: "Chief Executive Officer", confidence: "verified" as const },
    { fullName: "H Deputy", title: "Deputy Minister of Health", confidence: "verified" as const },
  ],
  openQuestions: [] as string[],
};
guardExecutiveMapperCriticalRoles(corp);
check(
  "default mode: CEO kept + tagged; Deputy Minister gets NO criticalRole (deputy veto)",
  corp.decisionMakers.some(
    (d) =>
      d.fullName === "G CEO" &&
      (d as { criticalRole?: string | null }).criticalRole === "ceo",
  ) &&
    (corp.decisionMakers.find((d) => d.fullName === "H Deputy") as
      | { criticalRole?: string | null }
      | undefined)?.criticalRole == null,
  corp.decisionMakers,
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
