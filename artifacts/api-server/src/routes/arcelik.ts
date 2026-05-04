import { Router, type IRouter } from "express";
import {
  db,
  arcelikProductsTable,
  arcelikCompetitorPricesTable,
  arcelikDataSourcesTable,
  arcelikCitiesTable,
  arcelikDealersTable,
  arcelikCampaignsTable,
  arcelikCalendarTable,
  arcelikKpiBenchmarksTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router: IRouter = Router();

router.get("/products", async (_req, res) => {
  try {
    const { category, priceTier } = _req.query;
    let rows;
    if (category && priceTier) {
      rows = await db
        .select()
        .from(arcelikProductsTable)
        .where(
          and(
            eq(arcelikProductsTable.category, String(category)),
            eq(arcelikProductsTable.priceTier, String(priceTier)),
          ),
        );
    } else if (category) {
      rows = await db
        .select()
        .from(arcelikProductsTable)
        .where(eq(arcelikProductsTable.category, String(category)));
    } else if (priceTier) {
      rows = await db
        .select()
        .from(arcelikProductsTable)
        .where(eq(arcelikProductsTable.priceTier, String(priceTier)));
    } else {
      rows = await db.select().from(arcelikProductsTable);
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

router.get("/competitor-prices", async (_req, res) => {
  try {
    const { brand, category } = _req.query;
    let rows;
    if (brand && category) {
      rows = await db
        .select()
        .from(arcelikCompetitorPricesTable)
        .where(
          and(
            eq(arcelikCompetitorPricesTable.brand, String(brand)),
            eq(arcelikCompetitorPricesTable.category, String(category)),
          ),
        );
    } else if (brand) {
      rows = await db
        .select()
        .from(arcelikCompetitorPricesTable)
        .where(eq(arcelikCompetitorPricesTable.brand, String(brand)));
    } else if (category) {
      rows = await db
        .select()
        .from(arcelikCompetitorPricesTable)
        .where(eq(arcelikCompetitorPricesTable.category, String(category)));
    } else {
      rows = await db.select().from(arcelikCompetitorPricesTable);
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch competitor prices" });
  }
});

router.get("/cities", async (_req, res) => {
  try {
    const rows = await db.select().from(arcelikCitiesTable);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch cities" });
  }
});

router.get("/dealers", async (_req, res) => {
  try {
    const { city } = _req.query;
    let rows;
    if (city) {
      rows = await db
        .select()
        .from(arcelikDealersTable)
        .where(eq(arcelikDealersTable.city, String(city)));
    } else {
      rows = await db.select().from(arcelikDealersTable);
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch dealers" });
  }
});

router.get("/campaigns", async (_req, res) => {
  try {
    const rows = await db.select().from(arcelikCampaignsTable);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch campaigns" });
  }
});

router.get("/calendar", async (_req, res) => {
  try {
    const rows = await db.select().from(arcelikCalendarTable);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch calendar" });
  }
});

router.get("/data-sources", async (_req, res) => {
  try {
    const rows = await db.select().from(arcelikDataSourcesTable);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch data sources" });
  }
});

router.get("/kpi-benchmarks", async (_req, res) => {
  try {
    const rows = await db.select().from(arcelikKpiBenchmarksTable);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch KPI benchmarks" });
  }
});

export default router;
