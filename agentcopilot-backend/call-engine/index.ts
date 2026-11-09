import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, ".env.local") });
dotenv.config({ path: path.resolve(__dirname, ".env") });

import { Server } from "socket.io";
import { CallSession } from "./session";
import { listSamples } from "./sample-loader";

const PORT = parseInt(process.env.CALL_ENGINE_PORT ?? "3003", 10);
const DEMO_MODE = process.env.DEMO_MODE ?? "both";
const SAAS_PORT = process.env.SAAS_BACKEND_PORT ?? "4000";

const io = new Server(PORT, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  path: "/",
});

const sessions = new Map<string, CallSession>(); // socket.id -> session

console.log(`[call-engine] Socket.IO listening on :${PORT} (mode: ${DEMO_MODE})`);

io.on("connection", (socket) => {
  console.log(`[call-engine] client connected: ${socket.id}`);

  // Send available demo samples immediately on connect
  try {
    const samples = listSamples();
    socket.emit("samples-list", samples);
  } catch (err) {
    console.warn("[call-engine] Could not list samples on connect:", err);
  }

  socket.on("command", async (cmd: any) => {
    if (!cmd || !cmd.type) return;
    console.log(`[call-engine] cmd from ${socket.id}:`, cmd.type);
    const session = sessions.get(socket.id);

    switch (cmd.type) {
      case "start_call": {
        // Tear down any prior session
        if (session) session.requestEnd();
        const s = new CallSession(socket, "live");
        sessions.set(socket.id, s);
        s.run().catch(console.error);
        break;
      }
      case "start_sample": {
        // Demo mode: play a pre-loaded sample file
        if (session) session.requestEnd();
        const s = new CallSession(socket, "demo");
        s.sampleId = cmd.sampleId || "Sample - 01";
        s.durationSec = cmd.durationSec ?? 90;
        s.timeScale = cmd.timeScale ?? 1.0;
        sessions.set(socket.id, s);
        s.runSample().catch(console.error);
        break;
      }
      case "end_call": {
        session?.requestEnd();
        break;
      }
      case "use_reply": {
        session?.injectReply(cmd.text);
        break;
      }
      case "simulate_customer": {
        session?.simulateCustomer(cmd.text);
        break;
      }
      case "synthesize": {
        session?.synthesize(cmd.text, cmd.requestId, cmd.language);
        break;
      }
      case "reset": {
        session?.requestEnd();
        sessions.delete(socket.id);
        break;
      }
      case "list_samples": {
        socket.emit("samples-list", listSamples());
        break;
      }
      case "get_scored_calls": {
        // Fetch from SaaS backend
        try {
          const res = await fetch(`http://127.0.0.1:${SAAS_PORT}/api/qa/calls?limit=200`);
          const data: any = await res.json();
          socket.emit("scored-calls", data.calls || []);
        } catch (e) {
          socket.emit("scored-calls", []);
        }
        break;
      }
    }
  });

  socket.on("audio-frame", async (pcm: ArrayBuffer) => {
    // LIVE mode: forward mic audio to Gnani Prisma
    const session = sessions.get(socket.id);
    if (session && session.mode === "live") {
      session.feedAudio(Buffer.from(pcm));
    }
  });

  socket.on("disconnect", () => {
    sessions.get(socket.id)?.requestEnd();
    sessions.delete(socket.id);
    console.log(`[call-engine] client disconnected: ${socket.id}`);
  });
});

export { io };
