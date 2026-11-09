"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = void 0;
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, ".env.local") });
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, ".env") });
const socket_io_1 = require("socket.io");
const session_1 = require("./session");
const sample_loader_1 = require("./sample-loader");
const PORT = parseInt(process.env.CALL_ENGINE_PORT ?? "3003", 10);
const DEMO_MODE = process.env.DEMO_MODE ?? "both";
const SAAS_PORT = process.env.SAAS_BACKEND_PORT ?? "4000";
const io = new socket_io_1.Server(PORT, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    path: "/",
});
exports.io = io;
const sessions = new Map(); // socket.id -> session
console.log(`[call-engine] Socket.IO listening on :${PORT} (mode: ${DEMO_MODE})`);
io.on("connection", (socket) => {
    console.log(`[call-engine] client connected: ${socket.id}`);
    // Send available demo samples immediately on connect
    try {
        const samples = (0, sample_loader_1.listSamples)();
        socket.emit("samples-list", samples);
    }
    catch (err) {
        console.warn("[call-engine] Could not list samples on connect:", err);
    }
    socket.on("command", async (cmd) => {
        if (!cmd || !cmd.type)
            return;
        console.log(`[call-engine] cmd from ${socket.id}:`, cmd.type);
        const session = sessions.get(socket.id);
        switch (cmd.type) {
            case "start_call": {
                // Tear down any prior session
                if (session)
                    session.requestEnd();
                const s = new session_1.CallSession(socket, "live");
                sessions.set(socket.id, s);
                s.run().catch(console.error);
                break;
            }
            case "start_sample": {
                // Demo mode: play a pre-loaded sample file
                if (session)
                    session.requestEnd();
                const s = new session_1.CallSession(socket, "demo");
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
                session?.synthesize(cmd.text, cmd.requestId);
                break;
            }
            case "reset": {
                session?.requestEnd();
                sessions.delete(socket.id);
                break;
            }
            case "list_samples": {
                socket.emit("samples-list", (0, sample_loader_1.listSamples)());
                break;
            }
            case "get_scored_calls": {
                // Fetch from SaaS backend
                try {
                    const res = await fetch(`http://127.0.0.1:${SAAS_PORT}/api/qa/calls?limit=200`);
                    const data = await res.json();
                    socket.emit("scored-calls", data.calls || []);
                }
                catch (e) {
                    socket.emit("scored-calls", []);
                }
                break;
            }
        }
    });
    socket.on("audio-frame", async (pcm) => {
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
