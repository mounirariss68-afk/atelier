/**
 * Task #628 — Microsoft 365 provisioning routes (HR / founding partner).
 *
 * Status + management surface for the per-person M365 ledger:
 *   GET   /roster/people/:personId/m365            → status wire
 *   POST  /roster/people/:personId/m365/provision  → launch check-then-create-or-link (202, poll status)
 *   POST  /roster/people/:personId/m365/recheck    → same run (idempotent; picks up pending licenses)
 *   GET   /roster/people/:personId/m365/plans      → live service-plan list for the assigned SKU
 *   PATCH /roster/people/:personId/m365/services   → toggle service plans (disabledPlans list)
 *
 * Provisioning runs fire in the background (launch-map guarded) — these
 * routes never hold a request open for Graph. Bespoke raw-fetch surface
 * (not in openapi), same pattern as the account-agent routes.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierEmployees,
  atelierContractors,
} from "@workspace/db";
import { isFoundingPartner, isHr } from "./personaRoles";
import {
  ensureProvisioningRow,
  getProvisioningRow,
  launchProvisioning,
  provisioningToWire,
  applyServicePlanChange,
  defaultProfileForWorkerType,
  disabledPlansForProfile,
  type MsServiceProfile,
} from "../../lib/atelier-ms-provisioning";
import { listSubscribedSkus, MsAdminError } from "../../lib/msGraphAdmin";

const router: IRouter = Router();

function ensureHrActor(
  req: Request,
  res: Response,
): typeof atelierUsers.$inferSelect | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  if (!isHr(me.role) && !isFoundingPartner(me.role)) {
    res.status(403).json({
      error: "forbidden",
      message: "Only HR or a founding partner can manage Microsoft 365 accounts.",
    });
    return null;
  }
  return me;
}

interface RosterHit {
  personId: string;
  personType: "employee" | "contractor";
  email: string;
  userId: string | null;
}

async function findRosterPerson(
  orgId: string,
  personId: string,
): Promise<RosterHit | null> {
  const [emp] = await db
    .select()
    .from(atelierEmployees)
    .where(
      and(
        eq(atelierEmployees.orgId, orgId),
        eq(atelierEmployees.id, personId),
        isNull(atelierEmployees.deletedAt),
      ),
    );
  if (emp) {
    return {
      personId: emp.id,
      personType: "employee",
      email: (emp.email ?? "").trim().toLowerCase(),
      userId: emp.userId ?? null,
    };
  }
  const [ct] = await db
    .select()
    .from(atelierContractors)
    .where(
      and(
        eq(atelierContractors.orgId, orgId),
        eq(atelierContractors.id, personId),
        isNull(atelierContractors.deletedAt),
      ),
    );
  if (!ct) return null;
  // Contractors link to a login by email (their table has no user_id).
  const email = (ct.email ?? "").trim().toLowerCase();
  let userId: string | null = null;
  if (email) {
    const users = await db
      .select({ id: atelierUsers.id, email: atelierUsers.email })
      .from(atelierUsers)
      .where(and(eq(atelierUsers.orgId, orgId), isNull(atelierUsers.deletedAt)));
    userId = users.find((u) => u.email.trim().toLowerCase() === email)?.id ?? null;
  }
  return { personId: ct.id, personType: "contractor", email, userId };
}

// @cli-skip: HR admin surface; no CLI shape (Task #628)
router.get("/roster/people/:personId/m365", async (req, res, next) => {
  try {
    const me = ensureHrActor(req, res);
    if (!me) return;
    const person = await findRosterPerson(me.orgId, String(req.params.personId));
    if (!person) {
      res.status(404).json({ error: "not-found", message: "No such roster person." });
      return;
    }
    const row = await getProvisioningRow(me.orgId, person.personId);
    res.json({
      ...provisioningToWire(row),
      personEmail: person.email || null,
      defaultProfile: defaultProfileForWorkerType(person.personType),
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR admin mutation; no CLI shape (Task #628)
router.post("/roster/people/:personId/m365/provision", async (req, res, next) => {
  try {
    const me = ensureHrActor(req, res);
    if (!me) return;
    const person = await findRosterPerson(me.orgId, String(req.params.personId));
    if (!person) {
      res.status(404).json({ error: "not-found", message: "No such roster person." });
      return;
    }
    if (!person.email.includes("@")) {
      res.status(422).json({
        error: "person-has-no-email",
        message: "The person needs an email address before a Microsoft account can be created.",
      });
      return;
    }
    const bodyProfile =
      req.body?.serviceProfile === "employee" || req.body?.serviceProfile === "contractor"
        ? (req.body.serviceProfile as MsServiceProfile)
        : undefined;
    await ensureProvisioningRow({
      orgId: me.orgId,
      personId: person.personId,
      personType: person.personType,
      userId: person.userId,
      email: person.email,
      serviceProfile: bodyProfile,
    });
    const started = launchProvisioning({
      orgId: me.orgId,
      personId: person.personId,
      actor: { id: me.id, name: me.name },
      serviceProfile: bodyProfile,
    });
    res.status(202).json({ ok: true, started });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR admin mutation; no CLI shape (Task #628)
router.post("/roster/people/:personId/m365/recheck", async (req, res, next) => {
  try {
    const me = ensureHrActor(req, res);
    if (!me) return;
    const person = await findRosterPerson(me.orgId, String(req.params.personId));
    if (!person) {
      res.status(404).json({ error: "not-found", message: "No such roster person." });
      return;
    }
    const row = await getProvisioningRow(me.orgId, person.personId);
    if (!row || row.status === "not_provisioned") {
      res.status(409).json({
        error: "not-provisioned",
        message: "Nothing to re-check — run provisioning first.",
      });
      return;
    }
    const started = launchProvisioning({
      orgId: me.orgId,
      personId: person.personId,
      actor: { id: me.id, name: me.name },
    });
    res.status(202).json({ ok: true, started });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR admin surface; no CLI shape (Task #628)
router.get("/roster/people/:personId/m365/plans", async (req, res, next) => {
  try {
    const me = ensureHrActor(req, res);
    if (!me) return;
    const person = await findRosterPerson(me.orgId, String(req.params.personId));
    if (!person) {
      res.status(404).json({ error: "not-found", message: "No such roster person." });
      return;
    }
    const row = await getProvisioningRow(me.orgId, person.personId);
    if (!row?.skuId) {
      res.status(409).json({
        error: "no-license",
        message: "No license is assigned yet — service plans appear once a seat is assigned.",
      });
      return;
    }
    const skus = await listSubscribedSkus();
    const sku = skus.find((s) => s.skuId === row.skuId);
    if (!sku) {
      res.status(404).json({ error: "sku-not-found", message: "The assigned license SKU is no longer in the tenant." });
      return;
    }
    const disabled = new Set(row.disabledPlans ?? []);
    res.json({
      skuId: sku.skuId,
      skuPartNumber: sku.skuPartNumber,
      plans: sku.servicePlans
        .filter((p) => (p.appliesTo ?? "User") === "User")
        .map((p) => ({
          servicePlanId: p.servicePlanId,
          servicePlanName: p.servicePlanName,
          enabled: !disabled.has(p.servicePlanId),
        })),
      profileDefaults: {
        employee: disabledPlansForProfile(sku, "employee"),
        contractor: disabledPlansForProfile(sku, "contractor"),
      },
    });
  } catch (err) {
    if (err instanceof MsAdminError) {
      res.status(502).json({ error: err.code, message: err.message });
      return;
    }
    next(err);
  }
});

// @cli-skip: HR admin mutation; no CLI shape (Task #628)
router.patch("/roster/people/:personId/m365/services", async (req, res, next) => {
  try {
    const me = ensureHrActor(req, res);
    if (!me) return;
    const person = await findRosterPerson(me.orgId, String(req.params.personId));
    if (!person) {
      res.status(404).json({ error: "not-found", message: "No such roster person." });
      return;
    }
    const disabledPlans = Array.isArray(req.body?.disabledPlans)
      ? (req.body.disabledPlans as unknown[]).filter((v): v is string => typeof v === "string").slice(0, 100)
      : null;
    if (!disabledPlans) {
      res.status(400).json({ error: "invalid-body", message: "disabledPlans must be an array of service-plan ids." });
      return;
    }
    const out = await applyServicePlanChange({
      orgId: me.orgId,
      personId: person.personId,
      actor: { id: me.id, name: me.name },
      disabledPlans,
    });
    if (!out.ok) {
      res.status(502).json({ error: "ms-update-failed", message: out.error });
      return;
    }
    const row = await getProvisioningRow(me.orgId, person.personId);
    res.json(provisioningToWire(row));
  } catch (err) {
    next(err);
  }
});

export default router;
