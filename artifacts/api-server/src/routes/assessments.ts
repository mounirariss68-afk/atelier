import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import {
  db,
  assessmentSubmissionsTable,
  callRequestsTable,
  teamInvitationsTable,
} from "@workspace/db";
import {
  getAssessment,
  scoreAssessment,
  computeReinventionIndex,
  type SubmissionInput,
  type ScoreResult,
  type AssessmentSlug,
} from "@workspace/assessments";
import { generateExecutiveMemo } from "../lib/aiMemo";
import { sendEmail } from "../lib/email";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const ProfileSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  company: z.string().min(1).max(160),
  role: z.string().min(1).max(120),
  industry: z.enum([
    "public-sector",
    "telecommunications",
    "financial-services",
    "energy-commodities",
    "retail-consumer",
    "travel-hospitality",
    "automotive",
    "healthcare",
    "manufacturing",
    "other",
  ]),
  country: z.enum(["ksa", "uae", "qatar", "bahrain", "kuwait", "oman", "other"]),
  revenueBand: z.string(),
  employeeCountBand: z.string(),
  language: z.enum(["en", "ar"]),
  optInMarketing: z.boolean().default(false),
});

const SubmitSchema = z.object({
  slug: z.enum(["ari", "mvi", "dafi", "uvr"]),
  profile: ProfileSchema,
  answers: z.record(z.string(), z.string()),
  useCases: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(140),
        answers: z.record(z.string(), z.string()),
      }),
    )
    .optional(),
  teamToken: z.string().optional(),
  teamRole: z.string().max(120).optional(),
});

router.post("/submit", async (req, res) => {
  const parsed = SubmitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid submission", details: parsed.error.format() });
    return;
  }
  const sub = parsed.data;
  const def = getAssessment(sub.slug as AssessmentSlug);
  let result: ScoreResult;
  try {
    result = scoreAssessment(def, sub as SubmissionInput);
  } catch (err) {
    logger.error({ err }, "Scoring failed");
    res.status(500).json({ error: "Scoring failed" });
    return;
  }
  const publicId = "mva_" + crypto.randomBytes(12).toString("hex");

  const [row] = await db
    .insert(assessmentSubmissionsTable)
    .values({
      publicId,
      slug: sub.slug,
      overallScore: result.overallScore,
      tier: result.tier,
      sovereignScore: result.sovereignSubScore.score,
      language: sub.profile.language,
      profile: sub.profile,
      answers: sub.answers,
      useCases: sub.useCases ?? null,
      result,
      teamToken: sub.teamToken ?? null,
      teamRole: sub.teamRole ?? null,
    })
    .returning();

  generateExecutiveMemo({ def, profile: sub.profile, result }, sub.profile.language)
    .then(async (memo) => {
      await db
        .update(assessmentSubmissionsTable)
        .set({ memo })
        .where(eq(assessmentSubmissionsTable.publicId, publicId));
    })
    .catch((err) => logger.warn({ err }, "Memo generation background error"));

  res.json({ publicId: row.publicId, result });
});

router.get("/submissions/:publicId", async (req, res) => {
  const id = req.params.publicId;
  const [row] = await db
    .select()
    .from(assessmentSubmissionsTable)
    .where(eq(assessmentSubmissionsTable.publicId, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({
    publicId: row.publicId,
    slug: row.slug,
    overallScore: row.overallScore,
    tier: row.tier,
    sovereignScore: row.sovereignScore,
    language: row.language,
    profile: row.profile,
    result: row.result,
    memo: row.memo,
    createdAt: row.createdAt,
  });
});

router.post("/submissions/:publicId/memo", async (req, res) => {
  const id = req.params.publicId;
  const [row] = await db
    .select()
    .from(assessmentSubmissionsTable)
    .where(eq(assessmentSubmissionsTable.publicId, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (row.memo) {
    res.json({ memo: row.memo });
    return;
  }
  const def = getAssessment(row.slug as AssessmentSlug);
  const memo = await generateExecutiveMemo(
    {
      def,
      profile: row.profile as never,
      result: row.result as ScoreResult,
    },
    row.language as "en" | "ar",
  );
  await db
    .update(assessmentSubmissionsTable)
    .set({ memo })
    .where(eq(assessmentSubmissionsTable.publicId, id));
  res.json({ memo });
});

router.post("/submissions/:publicId/email", async (req, res) => {
  const id = req.params.publicId;
  const [row] = await db
    .select()
    .from(assessmentSubmissionsTable)
    .where(eq(assessmentSubmissionsTable.publicId, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const profile = row.profile as { email: string; name: string; language: "en" | "ar" };
  const def = getAssessment(row.slug as AssessmentSlug);
  const isAr = profile.language === "ar";
  const subject = isAr
    ? `تقرير ${def.title.ar} الخاص بـ ${profile.name}`
    : `Your Maven AI ${def.code} report`;
  const url = `${(req.body?.viewUrl as string) || ""}` || "(report attached on the website)";
  const html = isAr
    ? `<p>عزيزي ${profile.name},</p><p>تجدون تقرير ${def.title.ar} (${row.tier}, ${row.overallScore}/5).</p><p><a href="${url}">عرض التقرير الكامل</a></p><p>— شراكة Maven AI</p>`
    : `<p>Hi ${profile.name},</p><p>Your ${def.title.en} report is ready (${row.tier} — ${row.overallScore}/5).</p><p><a href="${url}">View the full report</a></p><p>— The Maven AI partnership</p>`;
  const sent = await sendEmail({ to: profile.email, subject, html });
  res.json(sent);
});

const CallSchema = z.object({
  submissionPublicId: z.string().optional(),
  name: z.string().min(1),
  email: z.string().email(),
  company: z.string().min(1),
  role: z.string().optional(),
  preferredTime: z.string().optional(),
  message: z.string().optional(),
  language: z.enum(["en", "ar"]).default("en"),
});

router.post("/book-call", async (req, res) => {
  const parsed = CallSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.format() });
    return;
  }
  const [row] = await db.insert(callRequestsTable).values(parsed.data).returning();
  await sendEmail({
    to: process.env["FOUNDERS_EMAIL"] ?? "info@maven-ai.com",
    subject: `New 30-min readout request — ${row.company}`,
    html: `<p><b>${row.name}</b> (${row.email}) at <b>${row.company}</b> requested a readout.</p>
<p>Submission: ${row.submissionPublicId ?? "—"}<br/>Preferred: ${row.preferredTime ?? "—"}</p>
<p>${row.message ?? ""}</p>`,
  });
  res.json({ ok: true, id: row.id });
});

const TeamLinkSchema = z.object({
  slug: z.enum(["ari", "mvi", "dafi", "uvr"]),
  initiatorName: z.string().min(1),
  initiatorEmail: z.string().email(),
  company: z.string().min(1),
  seats: z.number().int().min(1).max(50).default(10),
});

router.post("/team-links", async (req, res) => {
  const parsed = TeamLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.format() });
    return;
  }
  const teamToken = "team_" + crypto.randomBytes(16).toString("hex");
  const [row] = await db
    .insert(teamInvitationsTable)
    .values({ ...parsed.data, teamToken })
    .returning();
  res.json({ teamToken: row.teamToken, slug: row.slug, seats: row.seats });
});

router.get("/team-links/:token", async (req, res) => {
  const [row] = await db
    .select()
    .from(teamInvitationsTable)
    .where(eq(teamInvitationsTable.teamToken, req.params.token))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ slug: row.slug, company: row.company, initiatorName: row.initiatorName, seats: row.seats, closed: row.closed });
});

router.get("/team-links/:token/heatmap", async (req, res) => {
  const [link] = await db
    .select()
    .from(teamInvitationsTable)
    .where(eq(teamInvitationsTable.teamToken, req.params.token))
    .limit(1);
  if (!link) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const rows = await db
    .select()
    .from(assessmentSubmissionsTable)
    .where(eq(assessmentSubmissionsTable.teamToken, req.params.token));
  if (rows.length < 3) {
    res.json({ ready: false, count: rows.length, needed: 3 });
    return;
  }
  const def = getAssessment(link.slug as AssessmentSlug);
  const dimIds = def.dimensions.map((d) => d.id);
  const respondents = rows.map((r) => {
    const result = r.result as ScoreResult;
    return {
      name: (r.profile as { name?: string } | null)?.name ?? "Anonymous",
      role: r.teamRole ?? (r.profile as { role?: string } | null)?.role ?? "—",
      overall: r.overallScore,
      dimensionScores: result.dimensionScores,
    };
  });
  const variance: Record<string, number> = {};
  for (const id of dimIds) {
    const vals = respondents.map((r) => r.dimensionScores[id] ?? 0);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const v = vals.reduce((s, x) => s + (x - mean) ** 2, 0) / vals.length;
    variance[id] = +v.toFixed(2);
  }
  res.json({
    ready: true,
    slug: link.slug,
    dimensions: def.dimensions.map((d) => ({ id: d.id, title: d.title })),
    respondents,
    variance,
  });
});

const ReinvSchema = z.object({
  ari: z.number().optional(),
  mvi: z.number().optional(),
  dafi: z.number().optional(),
});

router.post("/reinvention-index", async (req, res) => {
  const parsed = ReinvSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.format() });
    return;
  }
  res.json(computeReinventionIndex(parsed.data));
});

export default router;
