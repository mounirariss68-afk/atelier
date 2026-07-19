/**
 * Atelier — Finance Entities read routes (Task #372, real data Task #256).
 *
 * The finance entity list is served from the firm's real signing-entity
 * registry (firm profile `payload.legalEntities`) — the single source of
 * truth for legal entities. All demo/dummy entity data was permanently
 * removed (Task #114) per the production no-dummy-data policy; when the
 * registry is empty the collection is honestly empty. The registry has no
 * currency field, so `baseCurrency` is null (the dashboard falls back to
 * GBP and says so). Persona gating mirrors v5Routes: recruiter is denied
 * (it is /studio-only firm-wide).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { atelierUsers } from "@workspace/db";
import { listSigningEntities, type SigningEntity } from "../../lib/atelier-contract-service";

const router: IRouter = Router();

type Me = typeof atelierUsers.$inferSelect;

function ensurePersona(req: Request, res: Response): Me | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return me;
}

function denyRecruiter(me: Me, res: Response): boolean {
  if (me.role === "recruiter") {
    res.status(403).json({
      error: "recruiter-scope",
      message: "Recruiter persona may only access /studio surfaces.",
    });
    return true;
  }
  return false;
}

/**
 * Legacy rich entity shape from the retired Wave-1 demo backbone. Kept
 * only so the plan/reports/FPA layers (which still map over the seed)
 * keep compiling — the seed is permanently empty (no-dummy-data policy)
 * and those layers already handle the empty case. Real entity-level
 * finance slicing is future work.
 */
export interface LegacySeedEntity {
  id: string;
  legalName: string;
  shortName: string;
  kind: "parent" | "subsidiary" | "branch" | "jv";
  parentId: string | null;
  status: "active" | "dormant" | "winding_down";
  country: "SA" | "AE" | "GB";
  jurisdiction: string;
  baseCurrency: "SAR" | "AED" | "GBP" | "USD";
  reportingCurrency: "USD";
  fiscal: {
    yearEnd: string;
    vatPeriod: "monthly" | "quarterly";
    ctPeriod: "annual";
    nextClose: string;
    nextVatFiling: string;
    nextCtFiling: string;
  };
}

// Permanently empty — no dummy data may be reintroduced here.
export const ENTITIES_SEED: LegacySeedEntity[] = [];

export interface FinanceEntity {
  id: string;
  legalName: string;
  shortName: string;
  jurisdiction: string;
  country: string;
  registeredAddress: string;
  governingLaw: string;
  /** The signing-entity registry does not carry a currency yet — null,
   *  never fabricated. Consumers fall back to GBP presentation. */
  baseCurrency: string | null;
  isDefault: boolean;
}

function toFinanceEntity(e: SigningEntity): FinanceEntity {
  return {
    id: e.id,
    legalName: e.name,
    shortName: e.name,
    jurisdiction: e.jurisdiction,
    country: e.country,
    registeredAddress: e.registeredAddress,
    governingLaw: e.governingLaw,
    baseCurrency: null,
    isDefault: e.isDefault,
  };
}

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/entities", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiter(me, res)) return;
  const entities = await listSigningEntities(me.orgId);
  res.json({ items: entities.map(toFinanceEntity) });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/entities/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiter(me, res)) return;
  const entities = await listSigningEntities(me.orgId);
  const row = entities.find((e) => e.id === req.params.id);
  if (!row) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  res.json({ entity: toFinanceEntity(row) });
});

export default router;
