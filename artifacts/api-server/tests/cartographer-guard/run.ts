/**
 * pnpm --filter @workspace/api-server run test:cartographer-guard
 *
 * Unit test for guardCartographerEntityScope — the deterministic entity-scope
 * safety net behind the Account Cartographer. The model can slip and attribute a
 * subsidiary/brand CEO to the parent group; this guard catches that regardless
 * of model variance.
 *
 * Anchor: "Al Tayer Group" is chair-/owner-led with NO group CEO (apex =
 * Executive Chairman Obeid Al Tayer). Dee Sarai is CEO of Al Tayer Insignia (a
 * subsidiary) and must NEVER be left as the group CEO — she is downgraded to
 * inferred, her apex persona stripped, and tagged entityScope:"subsidiary".
 */
import {
  guardCartographerEntityScope,
  type CartographerOutput,
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

type DM = CartographerOutput["decisionMakers"][number];

function makeOutput(
  decisionMakers: DM[],
  canonicalName = "Al Tayer Group",
  openQuestions: string[] = [],
): CartographerOutput {
  return {
    account: { canonicalName },
    decisionMakers,
    researchBrief: { openQuestions },
  } as unknown as CartographerOutput;
}

// 1) Subsidiary CEO (explicit scope) is downgraded and de-aped.
{
  const out = makeOutput([
    {
      fullName: "Dee Sarai",
      title: "CEO",
      buyerPersona: "CEO",
      entityScope: "subsidiary",
      entityName: "Al Tayer Insignia",
      confidence: "verified",
    } as DM,
  ]);
  guardCartographerEntityScope(out);
  const dm = out.decisionMakers[0];
  check("subsidiary CEO downgraded to inferred", dm.confidence === "inferred", dm.confidence);
  check("subsidiary CEO persona de-aped", dm.buyerPersona === "business_head", dm.buyerPersona);
  check("subsidiary scope preserved", dm.entityScope === "subsidiary", String(dm.entityScope));
  check(
    "openQuestions notes missing group CEO",
    (out.researchBrief?.openQuestions ?? []).some((q) =>
      q.toLowerCase().includes("group-level ceo"),
    ),
  );
}

// 2) entityName mismatch (no explicit scope) is treated as subsidiary.
{
  const out = makeOutput([
    {
      fullName: "Someone Else",
      title: "Group CEO",
      buyerPersona: "CEO",
      entityName: "Al Tayer Insignia",
      entityScope: null,
      confidence: "verified",
    } as DM,
  ]);
  guardCartographerEntityScope(out);
  const dm = out.decisionMakers[0];
  check("mismatched-entity apex downgraded", dm.confidence === "inferred", dm.confidence);
  check("mismatched-entity tagged subsidiary", dm.entityScope === "subsidiary", String(dm.entityScope));
}

// 3) Legitimate group apex (scope = parent_group, entity matches) is untouched.
{
  const out = makeOutput([
    {
      fullName: "Real Group CEO",
      title: "Group CEO",
      buyerPersona: "CEO",
      entityScope: "parent_group",
      entityName: "Al Tayer Group",
      confidence: "verified",
    } as DM,
  ]);
  guardCartographerEntityScope(out);
  const dm = out.decisionMakers[0];
  check("genuine group apex stays verified", dm.confidence === "verified", dm.confidence);
  check("genuine group apex keeps CEO persona", dm.buyerPersona === "CEO", dm.buyerPersona);
  check(
    "no spurious openQuestions note",
    !(out.researchBrief?.openQuestions ?? []).some((q) =>
      q.toLowerCase().includes("group-level ceo"),
    ),
  );
}

// 4) Non-apex subsidiary exec (e.g. CFO) is left alone — we only guard apex.
{
  const out = makeOutput([
    {
      fullName: "Sub CFO",
      title: "CFO",
      buyerPersona: "procurement",
      entityScope: "subsidiary",
      entityName: "Al Tayer Insignia",
      confidence: "verified",
    } as DM,
  ]);
  guardCartographerEntityScope(out);
  const dm = out.decisionMakers[0];
  check("non-apex subsidiary exec untouched", dm.confidence === "verified", dm.confidence);
  check("non-apex persona unchanged", dm.buyerPersona === "procurement", dm.buyerPersona);
}

// 5) Title-based apex detection (no CEO persona) still fires on subsidiary scope.
{
  const out = makeOutput([
    {
      fullName: "Titled Exec",
      title: "Chief Executive Officer",
      entityScope: "subsidiary",
      entityName: "Al Tayer Insignia",
      confidence: "verified",
    } as DM,
  ]);
  guardCartographerEntityScope(out);
  const dm = out.decisionMakers[0];
  check("title-detected apex downgraded", dm.confidence === "inferred", dm.confidence);
}

// 6) Legal-suffix / token variance on a genuine parent CEO must NOT downgrade.
//    normName() strips group/holding/llc/ltd/etc, so "Al Tayer Group LLC" and the
//    canonical "Al Tayer Group" must normalise equal — a real group CEO whose
//    entityName carries a legal suffix is not a mismatch and stays verified.
{
  const out = makeOutput([
    {
      fullName: "Genuine Apex",
      title: "Group CEO",
      buyerPersona: "CEO",
      entityScope: "parent_group",
      entityName: "Al Tayer Group LLC",
      confidence: "verified",
    } as DM,
  ]);
  guardCartographerEntityScope(out, "Al Tayer Group");
  const dm = out.decisionMakers[0];
  check("legal-suffix parent CEO not downgraded", dm.confidence === "verified", dm.confidence);
  check("legal-suffix parent CEO keeps CEO persona", dm.buyerPersona === "CEO", dm.buyerPersona);
}

console.log("");
if (failures.length > 0) {
  console.error(`cartographer-guard: ${failures.length} assertion(s) failed`);
  process.exit(1);
}
console.log("cartographer-guard: all assertions passed");
