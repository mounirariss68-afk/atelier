// Parity + edge-case probe for the deliberately duplicated brief distiller:
//   server: src/lib/atelier-brief-view.ts
//   web:    artifacts/atelier/src/lib/briefView.ts
// The two copies must stay behaviorally identical (see memory topic
// atelier-brief-balanced-view.md). Run: pnpm exec tsx tests/crm/brief-view-distill-probe.ts

import { distillBriefView as serverDistill } from "../../src/lib/atelier-brief-view.js";
import { distillBriefView as webDistill } from "../../../atelier/src/lib/briefView.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS  ${name}`);
  else {
    failures++;
    console.log(`FAIL  ${name}`, detail === undefined ? "" : JSON.stringify(detail));
  }
}

const cases: Array<[string, Parameters<typeof serverDistill>[0]]> = [
  ["no stress test (legacy)", { whyNowHypothesis: "Why now text." }],
  ["empty brief", {}],
  ["revised-only", { stressTest: { revisedHypothesis: "Revised view." } }],
  [
    "why-now-only with caveats",
    {
      whyNowHypothesis: "Why now.",
      stressTest: {
        failureScenarios: ["f1", "f2", "f3"],
        likelyObjections: ["o1", "o2", "o3"],
        assumptions: { evidenced: ["e1"], untestedButLikely: [], uncertain: ["u1", "u2"] },
      },
    },
  ],
  [
    "full stress test",
    {
      whyNowHypothesis: "Pre-test hypothesis.",
      stressTest: {
        revisedHypothesis: "Post-test view.",
        failureScenarios: ["fail A", "fail B"],
        likelyObjections: ["obj A"],
        assumptions: { evidenced: ["e1", "e2"], untestedButLikely: ["t1"], uncertain: [] },
        evidenceToStrengthen: [{ evidence: "ev", whereToFind: "wtf" }],
      },
    },
  ],
  [
    "malformed lists",
    {
      whyNowHypothesis: "  ",
      stressTest: {
        revisedHypothesis: null,
        failureScenarios: ["", "  ", "real failure"],
        likelyObjections: null,
        assumptions: { evidenced: null, untestedButLikely: ["", "x"], uncertain: ["  "] },
        evidenceToStrengthen: [{ evidence: "", whereToFind: "" }],
      },
    },
  ],
];

for (const [name, input] of cases) {
  const s = serverDistill(input);
  const w = webDistill(input as never);
  check(`parity: ${name}`, JSON.stringify(s) === JSON.stringify(w), { s, w });
}

// Behavioral contract assertions (on the server copy).
const legacy = serverDistill({ whyNowHypothesis: "Why now text." });
check("legacy: ourView falls back to whyNow", legacy.ourView === "Why now text." && !legacy.fromStressTest);
check("legacy: no watch-outs / confidence", legacy.watchOuts.length === 0 && legacy.confidence === null);

const empty = serverDistill({});
check("empty: fully null", empty.ourView === null && empty.watchOuts.length === 0 && empty.confidence === null);

const full = serverDistill(cases[4][1]);
check("full: revised wins over pre-test", full.ourView === "Post-test view." && full.fromStressTest);
check("full: caveats = objections first then failures", JSON.stringify(full.watchOuts) === JSON.stringify(["obj A", "fail A", "fail B"]));
check("full: strong confidence (no uncertain, has evidenced)", full.confidence?.level === "strong");

const caveats = serverDistill(cases[3][1]);
check("caveats capped at 4", caveats.watchOuts.length === 4);
check("tentative when uncertain > evidenced", caveats.confidence?.level === "tentative");

const mal = serverDistill(cases[5][1]);
check("malformed: blank entries dropped", JSON.stringify(mal.watchOuts) === JSON.stringify(["real failure"]));
check("malformed: ourView null (blank whyNow)", mal.ourView === null);
check("malformed: empty evidence rows dropped", mal.evidenceToStrengthen.length === 0);

if (failures) {
  console.log(`${failures} FAILURES`);
  process.exit(1);
}
console.log("ALL PASS");
