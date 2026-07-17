/**
 * Task #55 — My Performance + My Learning regression probe.
 *
 * Runs standalone (tsx ./tests/perf-learning/run.ts) booting the app
 * in-process via app.listen(0); NODE_ENV=test enables the persona-cookie
 * bypass. All rows created here are removed in `finally`.
 *
 * Coverage:
 *   1. HR drafts a review → invisible on /me/reviews; release → visible;
 *      hrNotes never leaks in the self shape; pull-back hides it again
 *   2. contractor → /me/reviews & /me/goals 403; consultant → HR routes 403
 *   3. goals round-trip: HR creates + employee sees own only
 *   4. training materials: audience targeting (all / employees /
 *      contractors), completion mark idempotent, HR completion overview
 *   5. archive removes the material from /me/learning
 */

// --- env setup MUST run before any value-import of @workspace/db / app ---
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
process.env.ATELIER_MOCK_AGENTS = process.env.ATELIER_MOCK_AGENTS ?? "1";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import type { AddressInfo } from "node:net";
import { eq, like } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const HR_ID = `p_test_hr_${STAMP}`;
const EMP_ID = `p_test_emp_${STAMP}`;
const EMP2_ID = `p_test_emp2_${STAMP}`;
const CT_ID = `p_test_ct_${STAMP}`;
const CONSULTANT_ID = `p_test_cons_${STAMP}`;

const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else {
    failures.push(name);
    console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}
function group(title: string): void {
  console.log(`\n\u2500\u2500 ${title}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("\u2717 DATABASE_URL is not set.");
    process.exit(1);
  }

  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierEmployees,
    atelierContractors,
    atelierPerformanceReviews,
    atelierPerformanceGoals,
    atelierTrainingMaterials,
    atelierTrainingCompletions,
    atelierSelfNotifications,
    atelierAuditEvents,
  } = D as any;
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;

  async function call(
    method: string,
    path: string,
    personaId: string,
    body?: Record<string, unknown>,
  ): Promise<{ status: number; body: any }> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: `atelier_persona=${personaId}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  const createdMaterialIds: string[] = [];
  let reviewId: string | null = null;
  let goalId: string | null = null;

  try {
    // --- ephemeral personas + roster records ---
    const personas = [
      { id: HR_ID, role: "hr", roleLabel: "HR", name: "Test HR" },
      { id: EMP_ID, role: "employee", roleLabel: "Employee", name: "Test Employee" },
      { id: EMP2_ID, role: "employee", roleLabel: "Employee", name: "Other Employee" },
      { id: CT_ID, role: "contractor", roleLabel: "Contractor", name: "Test Contractor" },
      { id: CONSULTANT_ID, role: "consultant", roleLabel: "Consultant", name: "Test Consultant" },
    ];
    for (const p of personas) {
      await db.insert(atelierUsers).values({
        id: p.id,
        orgId: ORG,
        email: `${p.id}@cognirise.ai`,
        name: p.name,
        initials: "TT",
        role: p.role,
        roleLabel: p.roleLabel,
        title: p.name,
        permissions: [],
        bdActive: false,
      }).onConflictDoNothing();
    }
    await db.insert(atelierEmployees).values({
      id: `emp_test_${STAMP}`,
      orgId: ORG,
      userId: EMP_ID,
      fullName: "Test Employee",
      email: `${EMP_ID}@cognirise.ai`,
      role: "employee",
      title: "Analyst",
    });
    await db.insert(atelierEmployees).values({
      id: `emp2_test_${STAMP}`,
      orgId: ORG,
      userId: EMP2_ID,
      fullName: "Other Employee",
      email: `${EMP2_ID}@cognirise.ai`,
      role: "employee",
      title: "Analyst",
    });
    await db.insert(atelierContractors).values({
      id: `ct_test_${STAMP}`,
      orgId: ORG,
      fullName: "Test Contractor",
      email: `${CT_ID}@cognirise.ai`,
    });

    // =====================================================================
    group("reviews \u00b7 draft/release lifecycle + self-scope");
    // =====================================================================
    const consList = await call("GET", "/people/performance/reviews", CONSULTANT_ID);
    check("consultant \u2192 HR reviews list 403", consList.status === 403, `status=${consList.status}`);

    const create = await call("POST", "/people/performance/reviews", HR_ID, {
      employeeId: `emp_test_${STAMP}`,
      cycle: "FY26 H1",
      selfRating: "meets",
      managerRating: "exceeds",
      strengths: "Strong client presence",
      growthAreas: "Delegation",
      managerSummary: "A very strong half.",
      hrNotes: "SECRET-HR-NOTE",
    });
    reviewId = create.body?.id ?? null;
    check(
      "HR create draft review \u2192 201",
      create.status === 201 && !!reviewId && create.body?.status === "draft",
      `status=${create.status} body=${JSON.stringify(create.body)?.slice(0, 200)}`,
    );

    const beforeRelease = await call("GET", "/me/reviews", EMP_ID);
    check(
      "draft invisible on /me/reviews",
      beforeRelease.status === 200 && Array.isArray(beforeRelease.body) &&
        !beforeRelease.body.some((r: any) => r.id === reviewId),
      `status=${beforeRelease.status} n=${beforeRelease.body?.length}`,
    );

    const badRelease = await call("POST", `/people/performance/reviews/${reviewId}/release`, EMP_ID, { released: true });
    check("employee cannot release \u2192 403", badRelease.status === 403, `status=${badRelease.status}`);

    const release = await call("POST", `/people/performance/reviews/${reviewId}/release`, HR_ID, { released: true });
    check(
      "HR release \u2192 200 status=released",
      release.status === 200 && release.body?.status === "released" && !!release.body?.releasedAt,
      `status=${release.status}`,
    );

    const afterRelease = await call("GET", "/me/reviews", EMP_ID);
    const mine = afterRelease.body?.find?.((r: any) => r.id === reviewId);
    check(
      "released review visible on /me/reviews",
      afterRelease.status === 200 && !!mine && mine.managerSummary === "A very strong half.",
      `status=${afterRelease.status} n=${afterRelease.body?.length}`,
    );
    check(
      "hrNotes NEVER in the self shape",
      !!mine && !("hrNotes" in mine) && !JSON.stringify(afterRelease.body).includes("SECRET-HR-NOTE"),
    );
    const otherEmp = await call("GET", "/me/reviews", EMP2_ID);
    check(
      "other employee never sees it",
      otherEmp.status === 200 && !otherEmp.body?.some((r: any) => r.id === reviewId),
    );
    const ctReviews = await call("GET", "/me/reviews", CT_ID);
    check("contractor \u2192 /me/reviews 403", ctReviews.status === 403, `status=${ctReviews.status}`);

    const pullBack = await call("POST", `/people/performance/reviews/${reviewId}/release`, HR_ID, { released: false });
    const afterPullBack = await call("GET", "/me/reviews", EMP_ID);
    check(
      "pull-back hides it again",
      pullBack.status === 200 && pullBack.body?.status === "draft" &&
        !afterPullBack.body?.some((r: any) => r.id === reviewId),
      `status=${pullBack.status}`,
    );

    // =====================================================================
    group("goals \u00b7 HR create + self-scope read");
    // =====================================================================
    const goalCreate = await call("POST", "/people/performance/goals", HR_ID, {
      employeeId: `emp_test_${STAMP}`,
      cycle: "FY26 H1",
      title: "Grow the retail account",
      description: "Own the expansion plan.",
      weightPct: 40,
    });
    goalId = goalCreate.body?.id ?? null;
    check("HR create goal \u2192 201", goalCreate.status === 201 && !!goalId, `status=${goalCreate.status}`);

    const myGoals = await call("GET", "/me/goals", EMP_ID);
    check(
      "employee sees own goal",
      myGoals.status === 200 && myGoals.body?.some((g: any) => g.id === goalId && g.weightPct === 40),
      `status=${myGoals.status} n=${myGoals.body?.length}`,
    );
    const otherGoals = await call("GET", "/me/goals", EMP2_ID);
    check(
      "other employee does not see it",
      otherGoals.status === 200 && !otherGoals.body?.some((g: any) => g.id === goalId),
    );
    const ctGoals = await call("GET", "/me/goals", CT_ID);
    check("contractor \u2192 /me/goals 403", ctGoals.status === 403, `status=${ctGoals.status}`);

    const goalPatch = await call("PATCH", `/people/performance/goals/${goalId}`, HR_ID, { status: "complete" });
    check("HR goal status patch \u2192 200 complete", goalPatch.status === 200 && goalPatch.body?.status === "complete");

    // =====================================================================
    group("learning \u00b7 audience targeting + completion");
    // =====================================================================
    const consMat = await call("POST", "/people/training-materials", CONSULTANT_ID, {
      title: "nope", kind: "link", url: "https://example.com",
    });
    check("consultant \u2192 add material 403", consMat.status === 403, `status=${consMat.status}`);

    const mkMaterial = async (title: string, audience: string) => {
      const r = await call("POST", "/people/training-materials", HR_ID, {
        title, kind: "link", url: "https://example.com/x", audience, topic: "Security",
      });
      if (r.body?.id) createdMaterialIds.push(r.body.id);
      return r;
    };
    const matAll = await mkMaterial(`All hands ${STAMP}`, "all");
    const matEmp = await mkMaterial(`Employees only ${STAMP}`, "employees");
    const matCt = await mkMaterial(`Contractors only ${STAMP}`, "contractors");
    check(
      "HR adds 3 link materials \u2192 201",
      matAll.status === 201 && matEmp.status === 201 && matCt.status === 201,
      `${matAll.status}/${matEmp.status}/${matCt.status}`,
    );

    const empLearning = await call("GET", "/me/learning", EMP_ID);
    const empIds = new Set((empLearning.body ?? []).map((m: any) => m.id));
    check(
      "employee sees all + employees-only, NOT contractors-only",
      empLearning.status === 200 && empIds.has(matAll.body.id) && empIds.has(matEmp.body.id) && !empIds.has(matCt.body.id),
      `ids=${[...empIds].join(",")}`,
    );
    const ctLearning = await call("GET", "/me/learning", CT_ID);
    const ctIds = new Set((ctLearning.body ?? []).map((m: any) => m.id));
    check(
      "contractor sees all + contractors-only, NOT employees-only",
      ctLearning.status === 200 && ctIds.has(matAll.body.id) && ctIds.has(matCt.body.id) && !ctIds.has(matEmp.body.id),
      `ids=${[...ctIds].join(",")}`,
    );

    const complete1 = await call("POST", `/me/learning/${matAll.body.id}/complete`, EMP_ID, {});
    const complete2 = await call("POST", `/me/learning/${matAll.body.id}/complete`, EMP_ID, {});
    check(
      "complete mark \u2192 200 completed=true, idempotent",
      complete1.status === 200 && complete1.body?.completed === true &&
        complete2.status === 200 && complete2.body?.completed === true &&
        complete1.body?.completedAt === complete2.body?.completedAt,
      `s1=${complete1.status} s2=${complete2.status}`,
    );
    const wrongAudience = await call("POST", `/me/learning/${matCt.body.id}/complete`, EMP_ID, {});
    check("completing an out-of-audience material \u2192 404", wrongAudience.status === 404, `status=${wrongAudience.status}`);

    const afterComplete = await call("GET", "/me/learning", EMP_ID);
    const doneRow = afterComplete.body?.find?.((m: any) => m.id === matAll.body.id);
    check("completion reflected in /me/learning", doneRow?.completed === true);

    const overview = await call("GET", `/people/training-materials/${matAll.body.id}/completions`, HR_ID);
    const empRow = overview.body?.find?.((p: any) => p.userId === EMP_ID);
    check(
      "HR completion overview shows the employee as completed",
      overview.status === 200 && empRow?.completed === true,
      `status=${overview.status} row=${JSON.stringify(empRow)}`,
    );

    const listMats = await call("GET", "/people/training-materials", HR_ID);
    const listRow = listMats.body?.find?.((m: any) => m.id === matAll.body.id);
    check(
      "HR list shows completionCount \u2265 1",
      listMats.status === 200 && (listRow?.completionCount ?? 0) >= 1,
      `count=${listRow?.completionCount}`,
    );

    // =====================================================================
    group("learning \u00b7 archive");
    // =====================================================================
    const archive = await call("DELETE", `/people/training-materials/${matEmp.body.id}`, HR_ID);
    const afterArchive = await call("GET", "/me/learning", EMP_ID);
    check(
      "archived material leaves /me/learning",
      archive.status === 200 && !afterArchive.body?.some((m: any) => m.id === matEmp.body.id),
      `status=${archive.status}`,
    );
  } finally {
    try {
      for (const id of createdMaterialIds) {
        await db.delete(atelierTrainingCompletions).where(eq(atelierTrainingCompletions.materialId, id));
        await db.delete(atelierTrainingMaterials).where(eq(atelierTrainingMaterials.id, id));
      }
      if (reviewId) await db.delete(atelierPerformanceReviews).where(eq(atelierPerformanceReviews.id, reviewId));
      if (goalId) await db.delete(atelierPerformanceGoals).where(eq(atelierPerformanceGoals.id, goalId));
      await db.delete(atelierSelfNotifications).where(eq(atelierSelfNotifications.userId, EMP_ID));
      await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.actorId, `p_test_%_${STAMP}`));
      await db.delete(atelierEmployees).where(eq(atelierEmployees.id, `emp_test_${STAMP}`));
      await db.delete(atelierEmployees).where(eq(atelierEmployees.id, `emp2_test_${STAMP}`));
      await db.delete(atelierContractors).where(eq(atelierContractors.id, `ct_test_${STAMP}`));
      for (const id of [HR_ID, EMP_ID, EMP2_ID, CT_ID, CONSULTANT_ID]) {
        await db.delete(atelierUsers).where(eq(atelierUsers.id, id));
      }
    } catch (err) {
      console.error("cleanup failed:", err);
    }
    server.close();
    await pool.end();
  }

  console.log(
    failures.length === 0
      ? "\n\u2713 perf-learning probe: all checks passed"
      : `\n\u2717 perf-learning probe: ${failures.length} failed:\n  - ${failures.join("\n  - ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
