import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./config/database";
import routes from "./routes";
import {
  stripePaymentWebhook,
  stripeSubscriptionWebhook,
} from "./controllers/payments";

const app = express();
const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://parardokan.vercel.app",
  ...(process.env.CLIENT_URL || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
]);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin is not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(async (_req, _res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/payments/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripePaymentWebhook
);
app.post(
  "/api/subscriptions/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeSubscriptionWebhook
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req, res) => {
  res.json({
    name: "Parar Dokan API",
    status: "ok",
    health: "/api/health",
  });
});

app.use("/api", routes);
// Vercel may strip the function's /api prefix before invoking Express.
app.use(routes);

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(err.stack);
    res.status(500).json({ error: "Internal server error" });
  }
);

if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 5000;
  connectDB().then(() => {
    app.listen(PORT, () => {
      console.log(`Parar Dokan API running on port ${PORT}`);
    });
  });
}

export default app;
