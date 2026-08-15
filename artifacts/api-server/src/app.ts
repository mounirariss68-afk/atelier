import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
// Trust exactly one upstream proxy hop (Replit edge) so per-IP rate
// limits read the real client IP without being spoofable.
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
app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());

// Firm-document upload endpoints accept base64 payloads (up to ~13.4MB for a
// 10MB file). They must be parsed with a raised limit BEFORE the default
// 100KB parser runs — express.json() sets req._body once parsed, so the
// default parser below is a no-op for these already-parsed requests.
const LARGE_JSON_UPLOAD_PATHS = [
  "/api/auth/partner-register-upload",
  "/api/atelier/partner-portal/company-documents",
];
const largeJsonParser = express.json({ limit: "16mb" });
app.use((req, res, next) => {
  if (
    req.method === "POST" &&
    LARGE_JSON_UPLOAD_PATHS.includes(req.path)
  ) {
    return largeJsonParser(req, res, next);
  }
  return next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
