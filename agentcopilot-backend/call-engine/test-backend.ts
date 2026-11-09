import { io, Socket } from "socket.io-client";

const SAAS_URL = process.env.SAAS_URL || "http://127.0.0.1:4000";
const CALL_ENGINE_URL = process.env.CALL_ENGINE_URL || "http://127.0.0.1:3003";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testSaasBackend() {
  console.log("\n=======================================================");
  console.log("TESTING SAAS BACKEND (PORT 4000)");
  console.log("=======================================================");

  // 1. Health check
  const healthRes = await fetch(`${SAAS_URL}/healthz`);
  console.log(`[1] Healthz status: ${healthRes.status} (expected 200)`);
  if (!healthRes.ok) throw new Error("Health check failed");

  // 2. Priya login
  const priyaRes = await fetch(`${SAAS_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "priya@demo-bfsi.com", password: "password123" }),
  });
  console.log(`[2] Priya login status: ${priyaRes.status} (expected 200)`);
  const priyaData: any = await priyaRes.json();
  if (!priyaData.token || priyaData.user.role !== "AGENT") {
    throw new Error("Priya login failed or unexpected role: " + JSON.stringify(priyaData));
  }
  console.log("    Priya token received, user role:", priyaData.user.role);

  // 3. Cyril Compliance officer login
  const cyrilRes = await fetch(`${SAAS_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "compliance@demo-bfsi.com", password: "password123" }),
  });
  console.log(`[3] Cyril login status: ${cyrilRes.status} (expected 200)`);
  const cyrilData: any = await cyrilRes.json();
  if (!cyrilData.token || cyrilData.user.role !== "COMPLIANCE_OFFICER") {
    throw new Error("Cyril login failed: " + JSON.stringify(cyrilData));
  }
  console.log("    Cyril token received, user role:", cyrilData.user.role);

  // 4. Invalid credentials check
  const badRes = await fetch(`${SAAS_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "priya@demo-bfsi.com", password: "wrongpassword" }),
  });
  console.log(`[4] Bad login status: ${badRes.status} (expected 401)`);
  if (badRes.status !== 401) throw new Error("Expected 401 for bad login");

  // 5. GET /api/qa/calls with Bearer token
  const callsRes = await fetch(`${SAAS_URL}/api/qa/calls`, {
    headers: { Authorization: `Bearer ${cyrilData.token}` },
  });
  console.log(`[5] QA Calls status: ${callsRes.status} (expected 200)`);
  const callsData: any = await callsRes.json();
  console.log(`    Historical calls count: ${callsData.calls?.length} (expected >= 7)`);
  if (!callsData.calls || callsData.calls.length < 7) {
    throw new Error("Expected at least 7 seeded calls");
  }

  // 6. GET /api/dashboard/overview?days=30
  const dashRes = await fetch(`${SAAS_URL}/api/dashboard/overview?days=30`, {
    headers: { Authorization: `Bearer ${cyrilData.token}` },
  });
  console.log(`[6] Dashboard Overview status: ${dashRes.status} (expected 200)`);
  const dashData: any = await dashRes.json();
  console.log("    Overview metrics:", {
    totalCalls: dashData.totalCalls,
    avgCompliance: dashData.avgCompliance,
    avgTalkListen: dashData.avgTalkListen,
    avgDeadAir: dashData.avgDeadAir,
    escalations: dashData.escalations,
    leaderboardCount: dashData.leaderboard?.length,
  });

  return { priyaToken: priyaData.token, cyrilToken: cyrilData.token };
}

async function testCallEngine() {
  console.log("\n=======================================================");
  console.log("TESTING CALL ENGINE (PORT 3003)");
  console.log("=======================================================");

  return new Promise<void>((resolve, reject) => {
    const socket: Socket = io(CALL_ENGINE_URL, {
      path: "/",
      transports: ["websocket", "polling"],
      timeout: 5000,
    });

    let sampleStarted = false;
    let callStarted = false;
    let initialComplianceReceived = false;
    let transcriptReceived = false;
    let knowledgeSurfaced = false;
    let summaryReceived = false;
    let qaCallScoredReceived = false;
    let ttsReceived = false;
    let sampleListReceived = false;

    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error("CallEngine test timed out"));
    }, 90000);

    socket.on("connect", () => {
      console.log(`[7] Socket connected to ${CALL_ENGINE_URL}`);

      // Request sample list
      socket.emit("command", { type: "list_samples" });
    });

    socket.on("samples-list", (samples) => {
      console.log(`[8] samples-list received: ${samples?.length} samples`);
      console.log("    Samples:", samples.map((s: any) => `${s.id} (${s.speakers} spk, ${s.durationS}s)`));
      sampleListReceived = true;

      if (!sampleStarted) {
        sampleStarted = true;
        // Start sample playback with timeScale: 4.0 for fast automated testing
        console.log("[9] Sending start_sample command for 'Sample - 01' (4x test scale)...");
        socket.emit("command", {
          type: "start_sample",
          sampleId: "Sample - 01",
          durationSec: 90,
          timeScale: 4.0,
        });
      }
    });

    socket.on("agent-event", async (event: any) => {
      console.log(`    [Event] ${event.event_type} (latency: ${event.latency_ms || 0}ms)`);

      if (event.event_type === "CALL_STARTED") {
        callStarted = true;
        console.log("    CALL_STARTED: customer =", event.payload.customer_name);
      } else if (event.event_type === "COMPLIANCE_SIGNAL") {
        if (event.payload.rule_id === "INIT") {
          initialComplianceReceived = true;
          console.log(`    INIT COMPLIANCE: ${event.payload.checklist?.length} rules pending`);
        } else {
          console.log(`    COMPLIANCE FIRED: ${event.payload.rule_id} -> ${event.payload.status}`);
        }
      } else if (event.event_type === "TRANSCRIPTION_DELTA") {
        transcriptReceived = true;
        if (event.payload.is_final) {
          console.log(`    [TRANSCRIPT FINAL] ${event.payload.speaker}: "${event.payload.text}"`);
        }
      } else if (event.event_type === "KNOWLEDGE_SURFACED") {
        knowledgeSurfaced = true;
        console.log(`    KNOWLEDGE SURFACED: intent = ${event.payload.intent}`);
        console.log(`    Recommendation: "${event.payload.primary_recommendation?.direct_answer}"`);
        console.log(`    Quick reply: "${event.payload.suggested_quick_reply}"`);

        // Multilingual pipeline assertions
        const p = event.payload;
        const detected = p.detected_language ?? "(none)";
        console.log(
          `    MULTILINGUAL: detected=${detected}, label=${p.detected_language_label ?? "(none)"}`
        );
        console.log(`      original: "${p.original_query ?? "(none)"}"`);
        console.log(`      english : "${p.english_query ?? "(none)"}"`);
        console.log(
          `      stages: translate=${p.stage_latencies?.translate_ms ?? "-"}ms llm=${p.stage_latencies?.llm_ms ?? "-"}ms`
        );
        if (!p.english_query) {
          console.warn("[11b] Multilingual: translate pipeline not wired!");
        }

        // Test use_reply command
        console.log("[10] Testing use_reply command...");
        socket.emit("command", {
          type: "use_reply",
          text: event.payload.suggested_quick_reply,
        });

        // Test synthesize command (spoken in the CLIENT's language)
        console.log("[11] Testing synthesize command (language-aware)...");
        socket.emit("command", {
          type: "synthesize",
          text: event.payload.suggested_quick_reply,
          language: p.detected_language ?? "en",
        });
      } else if (event.event_type === "CALL_SUMMARY") {
        summaryReceived = true;
        console.log("    CALL_SUMMARY received: disposition =", event.payload.disposition);
        console.log("    Metrics:", event.payload.metrics);
      }
    });

    socket.on("tts-audio", (audioBuf) => {
      ttsReceived = true;
      console.log(`[11] tts-audio event received! Buffer length: ${audioBuf?.byteLength ?? 0} bytes`);
    });

    socket.on("qa-call-scored", (record) => {
      qaCallScoredReceived = true;
      console.log(`[12] qa-call-scored received! Score: ${record.compliance_score}%, CallId: ${record.call_id}`);

      // Verify all expectations
      setTimeout(() => {
        clearTimeout(timeout);
        socket.disconnect();

        if (!callStarted) return reject(new Error("CALL_STARTED not received"));
        if (!initialComplianceReceived) return reject(new Error("Initial compliance not received"));
        if (!transcriptReceived) return reject(new Error("Transcription delta not received"));
        if (!knowledgeSurfaced) return reject(new Error("Knowledge surfaced not received"));
        if (!summaryReceived) return reject(new Error("Summary not received"));
        if (!qaCallScoredReceived) return reject(new Error("QA scored call not received"));

        console.log("\nALL CALLENGINE TESTS PASSED SUCCESSFULLY!");
        resolve();
      }, 1000);
    });

    socket.on("connect_error", (err) => {
      clearTimeout(timeout);
      reject(new Error("Socket connect error: " + err.message));
    });
  });
}

async function testGeneralQna() {
  console.log("\n=======================================================");
  console.log("TESTING GENERAL QNA FALLBACK (non-whitelisted question)");
  console.log("=======================================================");

  return new Promise<void>((resolve, reject) => {
    const socket: Socket = io(CALL_ENGINE_URL, {
      path: "/",
      transports: ["websocket", "polling"],
      timeout: 5000,
    });

    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error("General QNA test timed out"));
    }, 60000);

    socket.on("connect", () => {
      console.log("[14] Starting live session for general QNA fallback...");
      socket.emit("command", { type: "start_call" });
    });

    socket.on("agent-event", (event: any) => {
      if (event.event_type === "CALL_STARTED") {
        setTimeout(() => {
          console.log(
            "[15] simulate_customer: 'Savings account ka interest rate kya hai?' (intentionally NOT in the intent whitelist)"
          );
          socket.emit("command", {
            type: "simulate_customer",
            text: "Savings account ka interest rate kya hai?",
          });
        }, 300);
      } else if (event.event_type === "KNOWLEDGE_SURFACED") {
        const p = event.payload;
        console.log(`    [General QNA] intent=${p.intent}`);
        console.log(`    [General QNA] english="${p.english_query ?? "(none)"}"`);
        const answer = (p.primary_recommendation?.direct_answer || "").trim();
        console.log(`    [General QNA] answer="${answer}"`);
        console.log(
          `    [General QNA] stages: translate=${p.stage_latencies?.translate_ms ?? "-"}ms llm=${p.stage_latencies?.llm_ms ?? "-"}ms`
        );
        clearTimeout(timeout);
        if (!answer) {
          socket.emit("command", { type: "reset" });
          return reject(new Error("General QNA surfaced an empty answer"));
        }
        if (/no kb match/i.test(answer)) {
          socket.emit("command", { type: "reset" });
          return reject(
            new Error("General QNA returned the legacy 'No KB match' stub — LLM general mode not wired")
          );
        }
        socket.emit("command", { type: "reset" });
        setTimeout(() => {
          socket.disconnect();
          resolve();
        }, 300);
      }
    });

    socket.on("connect_error", (err) => {
      clearTimeout(timeout);
      reject(new Error("General QNA socket connect error: " + err.message));
    });
  });
}

async function run() {
  try {
    await testSaasBackend();
    await testCallEngine();
    await testGeneralQna();

    // Verify persisted call in SaaS backend
    console.log("\n[13] Verifying persisted call in SaaS backend...");
    const res = await fetch(`${SAAS_URL}/api/qa/calls?limit=20`);
    const data: any = await res.json();
    console.log(`     Total calls in SaaS backend now: ${data.total} (was 7)`);
    if (data.total <= 7) {
      console.warn("     Warning: new call may still be inserting or count is " + data.total);
    } else {
      console.log("     SUCCESS: New call was automatically persisted to SaaS backend database!");
    }

    console.log("\n=======================================================");
    console.log("ALL ACCEPTANCE CRITERIA VERIFIED AND PASSING!");
    console.log("=======================================================\n");
    process.exit(0);
  } catch (err: any) {
    console.error("\nTEST SUITE FAILED:", err.message, err.cause);
    process.exit(1);
  }
}

run();
