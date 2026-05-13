import { Router, type IRouter } from "express";
import healthRouter from "./health";
import assessmentsRouter from "./assessments";
import chatRouter from "./chat";
import arcelikRouter from "./arcelik";
import tasamaRouter from "./tasama";
import atelierRouter from "./atelier";
import salonRouter from "./salon";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/assessments", assessmentsRouter);
router.use("/chat", chatRouter);
router.use("/arcelik", arcelikRouter);
router.use("/tasama", tasamaRouter);
router.use("/atelier", atelierRouter);
router.use("/salon", salonRouter);

export default router;
