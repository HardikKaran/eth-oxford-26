import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import rateLimit from "express-rate-limit";

import config from "./config/index.js";
import logger, { createServiceLogger } from "./utils/logger.js";
import { initBlockchain, listenToEvents } from "./services/blockchain.js";
import { onPipelineEvent } from "./services/pipeline.js";
import {
  requestsRouter,
  deliveryRouter,
  fundRouter,
  pipelineRouter,
  authRouter,
  webhookRouter,
} from "./routes/index.js";

const log = createServiceLogger("server");

// ─── Express App ─────────────────────────────────────────────────────────────

const app = express();
const server = createServer(app);

// Security & parsing
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: config.env === "production" ? process.env.FRONTEND_URL : "*" }));
app.use(express.json({ limit: "5mb" }));
app.use(morgan("short", { stream: { write: (msg) => log.info(msg.trim()) } }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.env === "production" ? 100 : 1000,
  message: { error: "Too many requests, please try again later" },
});
app.use("/api/", limiter);

// ─── Routes ──────────────────────────────────────────────────────────────────

app.use("/api/requests", requestsRouter);
app.use("/api/delivery", deliveryRouter);
app.use("/api/fund", fundRouter);
app.use("/api/pipeline", pipelineRouter);
app.use("/api/auth", authRouter);
app.use("/api/webhooks", webhookRouter);

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "aidchain-backend",
    version: "1.0.0",
    env: config.env,
    timestamp: new Date().toISOString(),
  });
});

// API documentation summary
app.get("/api", (req, res) => {
  res.json({
    name: "AidChain API",
    version: "1.0.0",
    description: "Decentralised humanitarian aid protocol backend",
    endpoints: {
      auth: {
        "POST /api/auth/login": "Authenticate with wallet signature",
        "POST /api/auth/dev-token": "Get dev token (dev only)",
      },
      requests: {
        "POST /api/requests": "Submit new aid request (triggers pipeline)",
        "GET /api/requests/:id": "Get on-chain request state",
        "GET /api/requests/:id/pipeline": "Get pipeline execution state",
        "GET /api/requests/user/:address": "Get user's request IDs",
      },
      delivery: {
        "POST /api/delivery/confirm": "Submit delivery proof",
      },
      fund: {
        "GET /api/fund/stats": "Get fund pool statistics",
      },
      pipeline: {
        "GET /api/pipeline/active": "List active pipelines",
      },
      webhooks: {
        "POST /api/webhooks/zipline": "Zipline delivery callback",
      },
      websocket: {
        "ws://host/ws": "Real-time pipeline events",
      },
    },
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Error handler
app.use((err, req, res, next) => {
  log.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(500).json({ error: "Internal server error" });
});

// ─── WebSocket Server ────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server, path: "/ws" });

const wsClients = new Set();

wss.on("connection", (ws, req) => {
  log.info(`WebSocket client connected (${req.socket.remoteAddress})`);
  wsClients.add(ws);

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);
      // Clients can subscribe to specific request IDs
      if (msg.type === "subscribe" && msg.requestId !== undefined) {
        ws.subscribedRequestId = msg.requestId;
        ws.send(JSON.stringify({ type: "subscribed", requestId: msg.requestId }));
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on("close", () => {
    wsClients.delete(ws);
  });

  ws.on("error", (err) => {
    log.warn(`WebSocket error: ${err.message}`);
    wsClients.delete(ws);
  });

  // Send welcome
  ws.send(JSON.stringify({ type: "connected", message: "AidChain real-time feed" }));
});

// Broadcast pipeline events to WebSocket clients
onPipelineEvent((event) => {
  const message = JSON.stringify({ type: "pipeline_event", ...event });
  for (const ws of wsClients) {
    if (ws.readyState === 1) { // OPEN
      // Send to all, or only to subscribers of this request
      if (!ws.subscribedRequestId || ws.subscribedRequestId === event.requestId) {
        ws.send(message);
      }
    }
  }
});

// ─── Startup ─────────────────────────────────────────────────────────────────

async function start() {
  log.info("═══════════════════════════════════════════");
  log.info("  AidChain Backend Starting...");
  log.info("═══════════════════════════════════════════");

  // Initialize blockchain connection
  try {
    initBlockchain();
    log.info("Blockchain connection initialized");

    // Listen for on-chain events
    listenToEvents({
      onAidRequested: (data) => log.info(`Chain event: AidRequested #${data.requestId}`),
      onPayoutReleased: (data) => log.info(`Chain event: PayoutReleased #${data.requestId}`),
    });
  } catch (err) {
    log.warn(`Blockchain init failed (running in offline mode): ${err.message}`);
  }

  // Start HTTP + WebSocket server
  server.listen(config.port, () => {
    log.info(`Server listening on port ${config.port}`);
    log.info(`Environment: ${config.env}`);
    log.info(`Health: http://localhost:${config.port}/health`);
    log.info(`API docs: http://localhost:${config.port}/api`);
    log.info(`WebSocket: ws://localhost:${config.port}/ws`);
    log.info("═══════════════════════════════════════════");
  });
}

start().catch((err) => {
  log.error(`Fatal startup error: ${err.message}`);
  process.exit(1);
});

export default app;
