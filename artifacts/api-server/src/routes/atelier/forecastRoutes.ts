/**
 * Atelier — Task #241 Forecast roll-ups.
 *
 *   GET /forecast?by=partner|offering|sector|stage|quarter
 *
 * Each row exposes count, weightedValueUsd, and (where appropriate) a
 * breakdown by sales stage. Forecast values are derived from
 * dealSizeHypothesis * probabilityPct, matching the home pipeline math.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierOpportunities,
  atelierAccounts,
} from "@workspace/db";

function ensurePersona(req: Request, res: Response): typeof atelierUsers.$inferSelect | null {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

const router: IRouter = Router();

function quarterKey(d: Date): string {
  const y = d.getFullYear();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${y} Q${q}`;
}

router.get("/forecast", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const by = String(req.query.by ?? "partner");
  const opps = await db
    .select()
    .from(atelierOpportunities)
    .where(isNull(atelierOpportunities.deletedAt));
  const accts = await db.select().from(atelierAccounts);
  const acctMap = new Map(accts.map((a) => [a.id, a]));
  const users = await db.select().from(atelierUsers);
  const userMap = new Map(users.map((u) => [u.id, u]));

  type Row = {
    key: string;
    label: string;
    count: number;
    weightedValueUsd: number;
    rawValueUsd: number;
    byStage: Record<string, number>;
  };
  const buckets = new Map<string, Row>();
  function bump(key: string, label: string, o: typeof opps[number]) {
    const r =
      buckets.get(key) ??
      {
        key,
        label,
        count: 0,
        weightedValueUsd: 0,
        rawValueUsd: 0,
        byStage: {},
      };
    r.count += 1;
    r.weightedValueUsd += (o.dealSizeHypothesis * o.probabilityPct) / 100;
    r.rawValueUsd += o.dealSizeHypothesis;
    r.byStage[o.salesStage] = (r.byStage[o.salesStage] ?? 0) + 1;
    buckets.set(key, r);
  }
  for (const o of opps) {
    if (by === "partner") {
      const u = userMap.get(o.partnerOwnerId);
      bump(o.partnerOwnerId, u?.name ?? o.partnerOwnerId, o);
    } else if (by === "offering") {
      bump(o.offeringAnchor, o.offeringAnchor, o);
    } else if (by === "sector") {
      const a = acctMap.get(o.accountId);
      const sec = a?.sector ?? "unknown";
      bump(sec, sec, o);
    } else if (by === "stage") {
      bump(o.salesStage, o.salesStage, o);
    } else if (by === "quarter") {
      const q = o.nextMilestoneDate
        ? quarterKey(new Date(o.nextMilestoneDate))
        : quarterKey(new Date());
      bump(q, q, o);
    } else {
      res.status(400).json({ error: "invalid-by" });
      return;
    }
  }
  const rows = [...buckets.values()].sort(
    (a, b) => b.weightedValueUsd - a.weightedValueUsd,
  );
  const totals = rows.reduce(
    (acc, r) => ({
      count: acc.count + r.count,
      weightedValueUsd: acc.weightedValueUsd + r.weightedValueUsd,
      rawValueUsd: acc.rawValueUsd + r.rawValueUsd,
    }),
    { count: 0, weightedValueUsd: 0, rawValueUsd: 0 },
  );
  res.json({ by, rows, totals });
});

export default router;
