/**
 * Task #628 — GUARDED live probe of Microsoft 365 auto-provisioning against
 * the real Cognirise tenant (GoDaddy-resold).
 *
 * The live tenant's app registration currently has NO application-permission
 * roles granted (client-credentials token carries no `roles` claim), so the
 * expected outcome on this tenant is the FIRST-CLASS MANUAL PATH:
 *   - getAppToken() succeeds (client credentials are valid)
 *   - Graph directory calls fail with 401/403 → MsAdminError
 *     "admin-consent-required" (or "tenant-blocked" if GoDaddy refuses)
 *   - the provisioning engine parks the row in status "blocked" with the
 *     error captured — onboarding is NEVER blocked.
 *
 * Write guard: real directory WRITES (user creation) only run when the token
 * actually carries the required roles AND MS_PROBE_ALLOW_WRITE=1 is set.
 * Otherwise the probe only exercises token acquisition, read attempts, and
 * the blocked-path row lifecycle. Self-cleaning: temp employee row, the
 * provisioning row, and probe notifications are deleted in `finally`.
 *
 * Run: cd artifacts/api-server && npx tsx scripts/t628-m365-live-probe.ts
 */
process.env.NODE_ENV = "test";

const MOUNIR = "p_mounir_ariss";
const PROBE_EMAIL = "probe-t628@cognirise.ai";

function decodeJwtRoles(token: string): string[] {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return Array.isArray(payload.roles) ? payload.roles : [];
  } catch {
    return [];
  }
}

async function main() {
  const appMod = await import("../src/app.js");
  const app: any = (appMod as any).default ?? (appMod as any).app;
  const D: any = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierEmployees, atelierMsProvisioning, atelierSelfNotifications, atelierAuditEvents } = D;
  const { eq, and, like } = await import("drizzle-orm");
  const G = await import("../src/lib/msGraphAdmin.js");

  const server = app.listen(0);
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api/atelier`;
  const hdrs = { cookie: `atelier_persona=${MOUNIR}`, "content-type": "application/json" };

  let fails = 0;
  const check = (name: string, ok: boolean, extra?: unknown) => {
    if (!ok) fails++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`, ok ? "" : JSON.stringify(extra));
  };

  const empId = `emp_probe_t628_${Date.now()}`;
  let orgId: string | null = null;

  try {
    // ---- 1. Config + token acquisition ----
    check("MS admin app configured (secrets present)", G.msAdminConfigured());
    let roles: string[] = [];
    try {
      const token = await G.getAppToken();
      roles = decodeJwtRoles(token);
      check("client-credentials token acquired", true);
      console.log(`INFO  token roles claim: ${roles.length ? roles.join(", ") : "(none — admin consent NOT granted)"}`);
    } catch (err: any) {
      check("client-credentials token acquired", false, { code: err?.code, msg: err?.message });
    }
    const consentGranted =
      roles.includes("User.ReadWrite.All") && roles.includes("Directory.ReadWrite.All");

    // ---- 2. Read attempt — expected admin-consent-required on this tenant ----
    try {
      const skus = await G.listSubscribedSkus();
      check("subscribedSkus readable (consent granted)", consentGranted, { skus: skus.length });
      console.log(`INFO  tenant SKUs: ${skus.map((s: any) => `${s.skuPartNumber}(${s.prepaidUnits?.enabled ?? "?"} seats)`).join(", ")}`);
    } catch (err: any) {
      const graceful = err instanceof G.MsAdminError &&
        (err.code === "admin-consent-required" || err.code === "tenant-blocked");
      check("directory read degrades to first-class MsAdminError", graceful, {
        code: err?.code, msg: err?.message,
      });
      console.log(`INFO  manual path active — code=${err?.code}: ${err?.message}`);
    }

    // ---- 3. Blocked-path lifecycle through the real API routes ----
    const [mounir] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, MOUNIR));
    orgId = mounir?.orgId ?? null;
    check("resolved org id", !!orgId);
    if (!orgId) throw new Error("no org id — aborting");

    await db.insert(atelierEmployees).values({
      id: empId,
      orgId,
      fullName: "Probe T628 (temporary — safe to delete)",
      email: PROBE_EMAIL,
      role: "employee",
    });

    let r = await fetch(`${base}/roster/people/${empId}/m365`, { headers: hdrs });
    let j: any = await r.json();
    check("GET m365 status starts not_provisioned", r.status === 200 && j.status === "not_provisioned", { s: r.status, j });

    if (consentGranted && process.env.MS_PROBE_ALLOW_WRITE !== "1") {
      console.log("INFO  consent IS granted but MS_PROBE_ALLOW_WRITE!=1 — skipping live user creation (write guard).");
    } else {
      r = await fetch(`${base}/roster/people/${empId}/m365/provision`, { method: "POST", headers: hdrs, body: "{}" });
      j = await r.json();
      check("POST provision accepted (202, async)", r.status === 202 && j.ok === true, { s: r.status, j });

      // Poll the row until the async run settles.
      let row: any = null;
      for (let i = 0; i < 30; i++) {
        await new Promise((res) => setTimeout(res, 1000));
        [row] = await db
          .select()
          .from(atelierMsProvisioning)
          .where(and(eq(atelierMsProvisioning.orgId, orgId), eq(atelierMsProvisioning.personId, empId)));
        if (row && row.status !== "provisioning" && row.status !== "not_provisioned") break;
      }
      if (consentGranted) {
        check("provisioning reached a live state", ["provisioned", "linked_existing", "pending_license"].includes(row?.status), { row });
        // Self-clean the live directory user if we created one.
        if (row?.msUserId && row?.status !== "linked_existing") {
          await G.deleteUser(row.msUserId).catch((e: any) => console.log("WARN  live user cleanup failed:", e?.message));
          console.log("INFO  deleted probe directory user", row.msUserId);
        }
      } else {
        check("provisioning parked as blocked (manual path), never threw into onboarding", row?.status === "blocked", { row });
        check("blocked row captures the consent error", /consent|permission|authoriz/i.test(row?.lastError ?? ""), { lastError: row?.lastError });
      }

      // Onboarding-not-blocked invariant: status endpoint still healthy.
      r = await fetch(`${base}/roster/people/${empId}/m365`, { headers: hdrs });
      j = await r.json();
      check("status endpoint healthy after run", r.status === 200 && typeof j.status === "string", { s: r.status, j });
    }
  } finally {
    // ---- Self-clean ----
    try {
      if (orgId) {
        await db.delete(atelierMsProvisioning).where(and(eq(atelierMsProvisioning.orgId, orgId), eq(atelierMsProvisioning.personId, empId)));
        await db.delete(atelierSelfNotifications).where(and(eq(atelierSelfNotifications.orgId, orgId), like(atelierSelfNotifications.body, `%${PROBE_EMAIL}%`)));
        await db.delete(atelierAuditEvents).where(and(eq(atelierAuditEvents.orgId, orgId), eq(atelierAuditEvents.entityId, empId)));
      }
      await db.delete(atelierEmployees).where(eq(atelierEmployees.id, empId));
    } catch (err) {
      console.log("WARN  cleanup issue:", (err as Error).message);
    }
    server.close();
    await pool.end().catch(() => {});
  }

  console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("probe crashed:", err);
  process.exit(1);
});
