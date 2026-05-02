import { Router, type IRouter } from "express";
import healthRouter from "./health";
import assessmentsRouter from "./assessments";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/assessments", assessmentsRouter);

export default router;
