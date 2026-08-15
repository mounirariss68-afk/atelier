/**
 * Task #1136 — pure WPS SIF format tests (no DB). Run:
 *   pnpm --filter @workspace/api-server exec tsx scripts/wps-sif-test.ts
 */
import { buildWpsSif, wpsApplicability, sifName, type WpsEntityConfig, type WpsEmployeeInput } from "../src/lib/atelier-payroll/wpsSif.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { console.log(`  ok  ${name}`); return; }
  failures++;
  console.error(`FAIL  ${name}`, detail ?? "");
}

const ENTITY: WpsEntityConfig = {
  entityId: "ent1", name: "Cognirise FZ-LLC", country: "AE", freeZoneRegime: null,
  wps: { applicable: true, employerUniqueId: "1234567890123", agentBankRoutingCode: "999888777" },
};
function emp(over: Partial<WpsEmployeeInput> = {}): WpsEmployeeInput {
  return {
    employeeId: "e1", name: "Aisha Al Mansoori", mohrePersonId: "12345678901234",
    bankRoutingCode: "111222333", iban: "AE070331234567890123456", netPay: 12345.5,
    daysInMonth: 31, payableDays: 31, unpaidLeaveDays: 0, ...over,
  };
}
const AT = new Date(Date.UTC(2026, 7, 25, 9, 5, 7)); // 2026-08-25 09:05:07Z

// 1. Happy path — filename convention, EDR/SCR shape, CRLF, determinism.
{
  const r = buildWpsSif({ entity: ENTITY, periodLabel: "2026-08", employees: [emp()], generatedAt: AT });
  check("builds ok", r.ok === true, r);
  if (r.ok) {
    check("filename <EmployerUniqueID><DDMMYYYY><HHMMSS>.SIF", r.fileName === "123456789012325082026090507.SIF", r.fileName);
    const lines = r.content.split("\r\n").filter(Boolean);
    check("one EDR + one SCR", lines.length === 2 && lines[0].startsWith("EDR,") && lines[1].startsWith("SCR,"), lines);
    const edr = lines[0].split(",");
    check("EDR mohre/routing/iban", edr[1] === "12345678901234" && edr[2] === "111222333" && edr[3] === "AE070331234567890123456", edr);
    check("EDR period dates", edr[4] === "01/08/2026" && edr[5] === "31/08/2026", edr);
    check("EDR AED amount 2dp", edr[7] === "12345.50" && edr[8] === "0.00", edr);
    check("EDR name uppercase", edr[10] === "AISHA AL MANSOORI", edr);
    const scr = lines[1].split(",");
    check("SCR employer id + routing", scr[1] === "1234567890123" && scr[2] === "999888777", scr);
    check("SCR date/time/salary-month", scr[3] === "25/08/2026" && scr[4] === "090507" && scr[5] === "082026", scr);
    check("SCR count + total + AED", scr[6] === "1" && scr[7] === "12345.50" && scr[8] === "AED", scr);
    const again = buildWpsSif({ entity: ENTITY, periodLabel: "2026-08", employees: [emp()], generatedAt: AT });
    check("deterministic", again.ok && again.content === r.content);
  }
}

// 2. Name truncation + non-ASCII sanitization (≤40 chars).
{
  const long = "Ayşegül Öztürk-Alharbi bint Muhammad Al Falasi The Third";
  check("sifName truncates to ≤40 ascii", sifName(long).length <= 40 && /^[\x20-\x7E]+$/.test(sifName(long)), sifName(long));
  check("sifName strips diacritics", sifName("Ayşegül Öztürk") === "AYSEGUL OZTURK", sifName("Ayşegül Öztürk"));
  check("sifName strips CSV chars", !sifName('X, "Y"').includes(",") && !sifName('X, "Y"').includes('"'));
}

// 3. Leaver partial month — payable days carried into the EDR.
{
  const r = buildWpsSif({
    entity: ENTITY, periodLabel: "2026-08",
    employees: [emp({ payableDays: 14, netPay: 5250.333 })], generatedAt: AT,
  });
  check("leaver partial builds", r.ok === true, r);
  if (r.ok) {
    const edr = r.content.split("\r\n")[0].split(",");
    check("leaver days paid = 14", edr[6] === "14", edr);
    check("leaver amount rounded", edr[7] === "5250.33", edr);
  }
}

// 4. Missing identifiers block generation, listing exactly who/what.
{
  const r = buildWpsSif({
    entity: ENTITY, periodLabel: "2026-08",
    employees: [
      emp(),
      emp({ employeeId: "e2", name: "Deniz Kaya", mohrePersonId: null, iban: "GB33BUKB20201555555555" }),
    ],
    generatedAt: AT,
  });
  check("missing ids refuse", r.ok === false);
  if (!r.ok) {
    const fields = r.problems.map((p) => `${p.employeeId}:${p.field}`).sort();
    check("lists exactly e2 mohre + iban", fields.join("|") === "e2:iban|e2:mohrePersonId", r.problems);
  }
}

// 5. Exempt-entity refusal (DIFC/ADGM + explicit flag) — explanation, never a file.
{
  const difc = { ...ENTITY, freeZoneRegime: "DIFC" };
  const app = wpsApplicability(difc);
  check("DIFC exempt with reason", !app.applicable && /DIFC/.test(app.reason ?? ""), app);
  const r = buildWpsSif({ entity: difc, periodLabel: "2026-08", employees: [emp()], generatedAt: AT });
  check("DIFC build refused", r.ok === false && !r.ok && r.problems[0].field === "entity");
  const adgm = wpsApplicability({ ...ENTITY, freeZoneRegime: "ADGM (financial free zone)" });
  check("ADGM exempt", !adgm.applicable, adgm);
  const flagged = wpsApplicability({ ...ENTITY, wps: { ...ENTITY.wps, applicable: false } });
  check("explicit flag exempt", !flagged.applicable && /flagged WPS-exempt/.test(flagged.reason ?? ""), flagged);
  const nonAe = wpsApplicability({ ...ENTITY, country: "SA" });
  check("non-AE exempt", !nonAe.applicable);
}

// 6. Missing employer config blocks (not exempt — a validation problem).
{
  const noCfg = { ...ENTITY, wps: null };
  check("no config still applicable", wpsApplicability(noCfg).applicable === true);
  const r = buildWpsSif({ entity: noCfg, periodLabel: "2026-08", employees: [emp()], generatedAt: AT });
  check("no employer config refuses", r.ok === false && !r.ok && r.problems.some((p) => p.field === "employerUniqueId") && r.problems.some((p) => p.field === "agentBankRoutingCode"), r);
}

// 7. Zero/negative net pay refused; multiple records sorted by MOHRE id + summed total.
{
  const r0 = buildWpsSif({ entity: ENTITY, periodLabel: "2026-08", employees: [emp({ netPay: 0 })], generatedAt: AT });
  check("zero net refused", r0.ok === false);
  const r = buildWpsSif({
    entity: ENTITY, periodLabel: "2026-08",
    employees: [
      emp({ employeeId: "e2", mohrePersonId: "99999999999999", iban: "AE770331234567890123457", netPay: 0.1 }),
      emp({ netPay: 0.2 }),
    ],
    generatedAt: AT,
  });
  check("multi builds", r.ok === true);
  if (r.ok) {
    const lines = r.content.split("\r\n").filter(Boolean);
    check("sorted by mohre id", lines[0].split(",")[1] === "12345678901234" && lines[1].split(",")[1] === "99999999999999", lines);
    check("float-safe total 0.30", lines[2].split(",")[7] === "0.30" && r.totalNetPay === 0.3, lines[2]);
  }
}

// 8. IBAN MOD-97 checksum: structurally valid but bad check digits rejected.
{
  const bad = buildWpsSif({ entity: ENTITY, periodLabel: "2026-08", generatedAt: AT,
    employees: [emp({ employeeId: "e_badiban", iban: "AE000331234567890123456" })] });
  check("bad-checksum IBAN rejected", bad.ok === false && bad.problems.some((p) => p.field === "iban" && p.employeeId === "e_badiban"), bad.ok === false ? bad.problems : "built");
  const good = buildWpsSif({ entity: ENTITY, periodLabel: "2026-08", generatedAt: AT,
    employees: [emp({ employeeId: "e_goodiban", iban: "AE500331234567890123458" })] });
  check("valid-checksum IBAN accepted", good.ok === true, good.ok === false ? good.problems : "ok");
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nAll WPS SIF format tests passed.");
