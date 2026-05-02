import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
// Trust exactly one proxy hop (the Replit edge proxy in front of us).
// Using `true` would trust an unbounded chain of X-Forwarded-For values,
// which lets a client spoof their source IP and bypass per-IP rate limits.
// `1` tells Express to read the leftmost address in X-Forwarded-For from
// the single proxy directly upstream of this process, which is the
// behavior we actually want for the chat rate limiter.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
