import { Router, type IRouter } from "express";
import healthRouter from "./health";
import assessmentsRouter from "./assessments";
import chatRouter from "./chat";
import arcelikRouter from "./arcelik";
import tasamaRouter from "./tasama";
import atelierRouter from "./atelier";
import salonRouter from "./salon";
import authRouter from "./auth";
import { requireAuthSession } from "../lib/auth/session";

const router: IRouter = Router();

// Public surfaces: health check + the auth endpoints themselves.
router.use(healthRouter);
router.use("/auth", authRouter);

// Task #1 — everything else requires a valid server-side session. There is
// no default-persona fallback anywhere behind this gate; unauthenticated
// requests get 401. (NODE_ENV=test bypasses for the in-process CRM harness.)
router.use(requireAuthSession);
router.use("/assessments", assessmentsRouter);
router.use("/chat", chatRouter);
router.use("/arcelik", arcelikRouter);
router.use("/tasama", tasamaRouter);
router.use("/atelier", atelierRouter);
router.use("/salon", salonRouter);

export default router;
