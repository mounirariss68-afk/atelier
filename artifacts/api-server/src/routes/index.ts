import { Router, type IRouter } from "express";
import healthRouter from "./health";
import assessmentsRouter from "./assessments";
import chatRouter from "./chat";
import arcelikRouter from "./arcelik";
import tasamaRouter from "./tasama";
import atelierRouter from "./atelier";
import salonRouter from "./salon";
import authRouter from "./auth";
import esignWebhookRouter from "./esignWebhook";
import { msMobileOauthRouter } from "./atelier/msAuthRoutes";
import msCalendarWebhookRouter from "./msCalendarWebhook";
import { requireAuthSession } from "../lib/auth/session";
import { demoReadOnlyGuard } from "../lib/auth/demoReadOnly";
import assistantRouter from "./assistantRoutes";
import workflowRouter from "./workflowRoutes";

const router: IRouter = Router();

// Public surfaces: health check + the auth endpoints themselves.
router.use(healthRouter);
router.use("/auth", authRouter);
// Task #62 — DocuSeal webhook (no session; optionally secret-gated, and
// the payload is never trusted — it only triggers an authoritative
// re-fetch from the DocuSeal API).
router.use("/esign/webhook", esignWebhookRouter);
// Task #360 — mobile-initiated MS365 OAuth callback: the system browser
// carries no session cookie; the HMAC-signed, user-bound state is the
// credential. Web-flow callbacks fall through to the gated atelier router.
router.use(msMobileOauthRouter);
// Task #629 — Microsoft Graph calendar webhook: Graph carries no session;
// each notification is validated against the per-subscription clientState
// secret and only ever ENQUEUES a re-sync (payload content never trusted).
router.use("/ms/calendar/webhook", msCalendarWebhookRouter);

// Task #1 — everything else requires a valid server-side session. There is
// no default-persona fallback anywhere behind this gate; unauthenticated
// requests get 401. (NODE_ENV=test bypasses for the in-process CRM harness.)
router.use(requireAuthSession);
// Task #621 — App Store review demo account is strictly read-only. Every
// mutating HTTP method is rejected for the demo user across ALL data routes
// (REST, chat /cli/*, uploads). The only writes it can ever perform are the
// pre-gate auth endpoints needed to log in and out (mounted above); even
// /auth/change-password is blocked for this user inside the auth router.
router.use(demoReadOnlyGuard);
// Phase 0 (Oct 2026 audit): the marketing-site backends (diagnostic
// assessments, website chat, Arçelik pricing demo, Tasama demo PDFs) are
// not part of Atelier. They sat behind requireAuthSession, so the public
// site could not reach them anyway; they are mounted only when a deployment
// opts in, pending removal of the code and its tables.
if (process.env.ATELIER_DEMO_SITE_ROUTES === "1") {
  router.use("/assessments", assessmentsRouter);
  router.use("/chat", chatRouter);
  router.use("/arcelik", arcelikRouter);
  router.use("/tasama", tasamaRouter);
}
router.use("/atelier", atelierRouter);
router.use("/assistant", assistantRouter);
router.use("/workflows", workflowRouter);
router.use("/salon", salonRouter);

export default router;
