import express from "express";
import cors from "cors";
import morgan from "morgan";
import path from "path";
import fs from "fs";
import { authRoutes } from "./routes/auth";
import { qaRoutes } from "./routes/qa";
import { dashboardRoutes } from "./routes/dashboard";
import { ingestRoutes } from "./routes/ingest";
import { authMiddleware } from "./middleware/auth";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(morgan("tiny"));

app.get("/healthz", (_req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

// Public: login
app.use("/api/auth", authRoutes);

// Public: ingest (called by call-engine, no JWT)
app.use("/api/ingest", ingestRoutes);

// QA & Dashboard routes (supports Bearer token, with graceful demo fallback for local fetches)
app.use("/api/qa", (req, res, next) => {
  if (req.headers.authorization) {
    return authMiddleware(req, res, next);
  }
  next();
}, qaRoutes);

app.use("/api/dashboard", (req, res, next) => {
  if (req.headers.authorization) {
    return authMiddleware(req, res, next);
  }
  next();
}, dashboardRoutes);

// Serve frontend static files
const samplesDir = path.resolve(__dirname, "../../call-engine/samples");
app.use("/samples", express.static(samplesDir));

const socketClientFile = path.resolve(
  __dirname,
  "../../call-engine/node_modules/socket.io-client/dist/socket.io.min.js"
);
app.get("/socket.io.min.js", (_req, res) => {
  if (fs.existsSync(socketClientFile)) {
    res.sendFile(socketClientFile);
  } else {
    res.status(404).end();
  }
});

const frontendDir = path.resolve(__dirname, "../../frontend");
app.use(express.static(frontendDir));

app.get("/", (_req, res) => {
  res.sendFile(path.join(frontendDir, "auth_terminal.html"));
});

app.get("/auth-terminal", (_req, res) => {
  res.sendFile(path.join(frontendDir, "auth_terminal.html"));
});

app.get("/cockpit", (_req, res) => {
  res.sendFile(path.join(frontendDir, "agent_copilot_cockpit.html"));
});

app.get("/supervisor", (_req, res) => {
  res.sendFile(path.join(frontendDir, "supervisor_dashboard.html"));
});

app.get("/supervisor-dashboard", (_req, res) => {
  res.sendFile(path.join(frontendDir, "supervisor_dashboard.html"));
});

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("[err]", err);
  res.status(err.status ?? 500).json({ error: err.message ?? "Internal error" });
});

const PORT = parseInt(process.env.SAAS_BACKEND_PORT ?? "4000", 10);
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, "0.0.0.0", () => console.log(`[saas] backend listening on :${PORT}`));
}

export default app;
