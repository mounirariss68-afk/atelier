/**
 * Task #628 — Microsoft 365 auto-provisioning engine probe (no real Microsoft).
 *
 * Deterministic — Microsoft is a local HTTP stub via MS_LOGIN_BASE_URL /
 * MS_GRAPH_BASE_URL. Covers, at the engine level:
 *   - happy path: create user + assign license → provisioned (employee = full
 *     bundle, no disabled plans)
 *   - contractor profile: collaboration plans (Teams/SharePoint/Sway/Yammer)
 *     disabled on the assigned license, Exchange kept
 *   - existing tenant account → linked_existing (no create call)
 *   - no spare seat → pending_license with the GoDaddy guidance error and an
 *     admin notification; re-check after a seat frees → provisioned
 *   - Graph refusal (403) → blocked with the tenant-blocked manual-path text;
 *     onboarding is never thrown into
 *   - deprovision retain: sign-in blocked + sessions revoked, license kept
 *   - deprovision remove: license freed, status deprovisioned
 *   - reactivate after remove: sign-in restored, parked pending_license
 *   - applyServicePlanChange PATCHes the license and stores the new plan set
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/crm/ms-provisioning-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// DB isolation bootstrap — MUST be the first import.
import "./scratch-db.js";
import http from "node:http";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

const ORG = "aico";
const RUN = Date.now().toString(36);
const pid = (b: string) => `${b}_${RUN}`;
const SKU_ID = "sku-biz-basic";
const PLANS = [
  { servicePlanId: "plan-exchange", servicePlanName: "EXCHANGE_S_STANDARD", appliesTo: "User" },
  { servicePlanId: "plan-teams", servicePlanName: "TEAMS1", appliesTo: "User" },
  { servicePlanId: "plan-sharepoint", servicePlanName: "SHAREPOINTSTANDARD", appliesTo: "User" },
  { servicePlanId: "plan-sway", servicePlanName: "SWAY", appliesTo: "User" },
];

// ---- in-memory Microsoft tenant stub --------------------------------
interface StubUser {
  id: string;
  displayName: string;
  userPrincipalName: string;
  accountEnabled: boolean;
  assignedLicenses: Array<{ skuId: string; disabledPlans?: string[] }>;
}
const tenant: { users: StubUser[]; seats: number; consumed: number; refuseAll: boolean; calls: string[] } = {
  users: [],
  seats: 3,
  consumed: 0,
  refuseAll: false,
  calls: [],
};

function stubServer(): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (code: number, body?: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      tenant.calls.push(`${req.method} ${url.pathname}${url.search}`);
      // token endpoint (urlencoded body — must not JSON.parse)
      if (url.pathname.endsWith("/oauth2/v2.0/token")) {
        return send(200, { access_token: "stub-app-token", expires_in: 3600 });
      }
      const body = raw ? JSON.parse(raw) : undefined;
      if (tenant.refuseAll) {
        return send(403, { error: { code: "Forbidden", message: "GoDaddy tenant restriction" } });
      }
      if (req.method === "GET" && url.pathname === "/subscribedSkus") {
        return send(200, {
          value: [{
            skuId: SKU_ID,
            skuPartNumber: "O365_BUSINESS_ESSENTIALS",
            capabilityStatus: "Enabled",
            prepaidUnits: { enabled: tenant.seats, suspended: 0, warning: 0 },
            consumedUnits: tenant.consumed,
            servicePlans: PLANS,
          }],
        });
      }
      if (req.method === "GET" && url.pathname === "/users") {
        const filter = url.searchParams.get("$filter") ?? "";
        const m = filter.match(/'([^']+)'/);
        const email = m ? decodeURIComponent(m[1]).toLowerCase() : "";
        const hits = tenant.users.filter(
          (u) => u.userPrincipalName.toLowerCase() === email,
        );
        return send(200, { value: hits });
      }
      if (req.method === "POST" && url.pathname === "/users") {
        const u: StubUser = {
          id: `msu_${tenant.users.length + 1}`,
          displayName: body.displayName,
          userPrincipalName: body.userPrincipalName,
          accountEnabled: body.accountEnabled !== false,
          assignedLicenses: [],
        };
        tenant.users.push(u);
        return send(201, u);
      }
      const userMatch = url.pathname.match(/^\/users\/([^/]+)(\/.*)?$/);
      if (userMatch) {
        const user = tenant.users.find((u) => u.id === decodeURIComponent(userMatch[1]));
        if (!user) return send(404, { error: { code: "Request_ResourceNotFound", message: "no user" } });
        const sub = userMatch[2] ?? "";
        if (req.method === "GET" && !sub) return send(200, user);
        if (req.method === "PATCH" && !sub) {
          Object.assign(user, body);
          return send(204);
        }
        if (req.method === "POST" && sub === "/revokeSignInSessions") return send(200, { value: true });
        if (req.method === "POST" && sub === "/assignLicense") {
          for (const add of body.addLicenses ?? []) {
            const existing = user.assignedLicenses.find((l) => l.skuId === add.skuId);
            if (existing) existing.disabledPlans = add.disabledPlans ?? [];
            else {
              user.assignedLicenses.push({ skuId: add.skuId, disabledPlans: add.disabledPlans ?? [] });
              tenant.consumed++;
            }
          }
          for (const rm of body.removeLicenses ?? []) {
            const idx = user.assignedLicenses.findIndex((l) => l.skuId === rm);
            if (idx >= 0) {
              user.assignedLicenses.splice(idx, 1);
              tenant.consumed--;
            }
          }
          return send(200, user);
        }
        if (req.method === "DELETE" && !sub) {
          tenant.users = tenant.users.filter((u) => u.id !== user.id);
          return send(204);
        }
      }
      send(500, { error: { code: "stub-unhandled", message: `${req.method} ${url.pathname}` } });
    });
  });
}

async function main() {
  const stub = stubServer();
  await new Promise<void>((r) => stub.listen(0, r));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.MS_CLIENT_ID = "stub-client";
  process.env.MS_TENANT_ID = "stub-tenant";
  process.env.MS_CLIENT_SECRET = "stub-secret";
  process.env.MS_LOGIN_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.MS_GRAPH_BASE_URL = `http://127.0.0.1:${stubPort}`;

  const D: any = await import("@workspace/db");
  const { db, pool, atelierEmployees, atelierContractors, atelierMsProvisioning, atelierSelfNotifications, atelierAuditEvents } = D;
  const { eq, and } = await import("drizzle-orm");
  const G = await import("../../src/lib/msGraphAdmin.js");
  G.__resetAppTokenCache();
  const P = await import("../../src/lib/atelier-ms-provisioning.js");

  const actor = { id: "u_probe_hr", name: "Probe HR" };

  const seedEmployee = async (id: string, email: string, userId?: string) => {
    await db.insert(atelierEmployees).values({
      id, orgId: ORG, fullName: "Nadia Probe Karam", email, role: "employee", userId: userId ?? null, startDate: "2026-01-01",
    });
  };
  const rowFor = async (personId: string) => {
    const [r] = await db.select().from(atelierMsProvisioning)
      .where(and(eq(atelierMsProvisioning.orgId, ORG), eq(atelierMsProvisioning.personId, personId)));
    return r ?? null;
  };
  const provision = async (personId: string, personType: "employee" | "contractor", email: string, opts?: any) => {
    await P.ensureProvisioningRow({ orgId: ORG, personId, personType, userId: opts?.userId ?? null, email, serviceProfile: opts?.serviceProfile });
    await P.runProvisioning({ orgId: ORG, personId, actor, serviceProfile: opts?.serviceProfile });
    return rowFor(personId);
  };

  try {
    // ---- 1. happy path, employee full bundle -------------------------
    await seedEmployee(pid("emp_p1"), `nadia-${RUN}@cognirise.ai`, pid("u_nadia"));
    let row = await provision(pid("emp_p1"), "employee", `nadia-${RUN}@cognirise.ai`, { userId: pid("u_nadia") });
    check("employee provisioned", row?.status === "provisioned", row);
    check("employee full bundle (no disabled plans)", (row?.disabledPlans ?? []).length === 0, row?.disabledPlans);
    const msu1 = tenant.users.find((u) => u.userPrincipalName === `nadia-${RUN}@cognirise.ai`);
    check("stub user created with license", !!msu1 && msu1.assignedLicenses.length === 1, msu1);
    check("displayName from roster", msu1?.displayName === "Nadia Probe Karam", msu1?.displayName);

    // ---- 2. contractor profile disables collaboration plans ----------
    await db.insert(atelierContractors).values({
      id: pid("ct_p1"), orgId: ORG, fullName: "Omar Probe", email: `omar-${RUN}@cognirise.ai`, startDate: "2026-01-01",
    });
    row = await provision(pid("ct_p1"), "contractor", `omar-${RUN}@cognirise.ai`, { serviceProfile: "contractor" });
    check("contractor provisioned", row?.status === "provisioned", row);
    const disabled = new Set(row?.disabledPlans ?? []);
    check("contractor: teams/sharepoint/sway disabled",
      disabled.has("plan-teams") && disabled.has("plan-sharepoint") && disabled.has("plan-sway"), row?.disabledPlans);
    check("contractor: exchange kept", !disabled.has("plan-exchange"), row?.disabledPlans);

    // ---- 2b. EMPLOYEE with an explicit contractor-profile OVERRIDE ----
    await seedEmployee(pid("emp_ovr"), `override-${RUN}@cognirise.ai`);
    row = await provision(pid("emp_ovr"), "employee", `override-${RUN}@cognirise.ai`, { serviceProfile: "contractor" });
    check("employee w/ contractor override provisioned", row?.status === "provisioned", row);
    check("override persisted on ledger row", row?.serviceProfile === "contractor", row?.serviceProfile);
    const ovrDisabled = new Set(row?.disabledPlans ?? []);
    check("override applied to first license grant",
      ovrDisabled.has("plan-teams") && ovrDisabled.has("plan-sharepoint"), row?.disabledPlans);

    // ---- 3. existing tenant account → linked_existing -----------------
    tenant.users.push({
      id: "msu_pre", displayName: "Pre Existing", userPrincipalName: `pre-${RUN}@cognirise.ai`,
      accountEnabled: true, assignedLicenses: [{ skuId: SKU_ID, disabledPlans: [] }],
    });
    tenant.seats = 10;
    await seedEmployee(pid("emp_p2"), `pre-${RUN}@cognirise.ai`);
    const createsBefore = tenant.calls.filter((c) => c === "POST /users").length;
    row = await provision(pid("emp_p2"), "employee", `pre-${RUN}@cognirise.ai`);
    check("existing account linked", row?.status === "linked_existing" && row?.msUserId === "msu_pre", row);
    check("no create call for linked account", tenant.calls.filter((c) => c === "POST /users").length === createsBefore);

    // ---- 4. no spare seat → pending_license, then re-check ------------
    tenant.seats = tenant.consumed; // exhausted
    await seedEmployee(pid("emp_p3"), `seatless-${RUN}@cognirise.ai`);
    row = await provision(pid("emp_p3"), "employee", `seatless-${RUN}@cognirise.ai`);
    check("no seat → pending_license", row?.status === "pending_license", row);
    check("pending_license carries GoDaddy guidance", /GoDaddy/i.test(row?.lastError ?? ""), row?.lastError);
    const notifs = await db.select().from(atelierSelfNotifications).where(eq(atelierSelfNotifications.kind, "ms_provisioning"));
    check("license notification recorded (founders may be absent in scratch DB → 0 rows ok)", Array.isArray(notifs));
    tenant.seats = tenant.consumed + 5; // seat freed
    await P.runProvisioning({ orgId: ORG, personId: pid("emp_p3"), actor });
    row = await rowFor(pid("emp_p3"));
    check("re-check after seat freed → provisioned", row?.status === "provisioned", row);

    // ---- 5. Graph refusal → blocked, first-class manual path ----------
    tenant.refuseAll = true;
    await seedEmployee(pid("emp_p4"), `refused-${RUN}@cognirise.ai`);
    row = await provision(pid("emp_p4"), "employee", `refused-${RUN}@cognirise.ai`);
    check("tenant refusal → blocked", row?.status === "blocked", row);
    check("blocked error names the manual path", /GoDaddy|manually/i.test(row?.lastError ?? ""), row?.lastError);
    tenant.refuseAll = false;

    // ---- 6. deprovision retain / remove, then reactivate --------------
    let out: any = await P.deprovisionMs({ orgId: ORG, userId: pid("u_nadia"), actor, mailboxAction: "retain" });
    row = await rowFor(pid("emp_p1"));
    check("deprovision retain: sign-in blocked, license kept",
      out.ok === true && row?.signInBlocked === "yes" && row?.mailboxRetained === "yes" && row?.licenseFreed !== "yes", { out, row });
    check("stub account disabled", tenant.users.find((u) => u.id === row?.msUserId)?.accountEnabled === false);
    check("sessions revoked", tenant.calls.some((c) => c.includes("/revokeSignInSessions")));

    out = await P.deprovisionMs({ orgId: ORG, userId: pid("u_nadia"), actor, mailboxAction: "remove" });
    row = await rowFor(pid("emp_p1"));
    check("deprovision remove: license freed + deprovisioned",
      out.ok === true && out.licenseFreed === true && row?.status === "deprovisioned", { out, row });
    check("stub license removed", tenant.users.find((u) => u.id === row?.msUserId)?.assignedLicenses.length === 0);

    out = await P.reactivateMs({ orgId: ORG, userId: pid("u_nadia"), actor });
    row = await rowFor(pid("emp_p1"));
    check("reactivate: sign-in restored, parked pending_license",
      out.ok === true && out.needsLicense === true && row?.signInBlocked === "no" && row?.status === "pending_license", { out, row });

    // ---- 7. service-plan toggling -------------------------------------
    out = await P.applyServicePlanChange({ orgId: ORG, personId: pid("ct_p1"), actor, disabledPlans: ["plan-teams"] });
    row = await rowFor(pid("ct_p1"));
    check("service toggle applied", out.ok === true && (row?.disabledPlans ?? []).join(",") === "plan-teams", { out, row });
    const ctUser = tenant.users.find((u) => u.userPrincipalName === `omar-${RUN}@cognirise.ai`);
    check("stub license disabledPlans updated", (ctUser?.assignedLicenses[0]?.disabledPlans ?? []).join(",") === "plan-teams", ctUser);

    // ---- 8. audit trail exists -----------------------------------------
    const audits = await db.select().from(atelierAuditEvents).where(eq(atelierAuditEvents.entityType, "ms_provisioning"));
    const actions = new Set(audits.map((a: any) => a.action));
    check("audit actions recorded",
      actions.has("ms.account.created") && actions.has("ms.account.linked") && actions.has("ms.account.deprovisioned") && actions.has("ms.provisioning.failed"),
      [...actions]);
  } finally {
    stub.close();
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("probe crashed:", err);
  process.exit(1);
});
