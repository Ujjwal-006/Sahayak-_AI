"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.gnaniAsrStream = gnaniAsrStream;
exports.gnaniAsrBatch = gnaniAsrBatch;
const ws_1 = __importDefault(require("ws"));
// ---------------------------------------------------------------------------
// Gnani Speech-to-Text (Prisma) — ONE GNANI_API_KEY is shared with TTS.
// Env vars are read lazily so dotenv can run after this module is imported.
// Docs: https://docs.gnani.ai/api/STT/stt-websocket.md
// ---------------------------------------------------------------------------
const PLACEHOLDER = "REPLACE_WITH_YOUR_GNANI_KEY";
function gnaniKey() {
    const key = process.env.GNANI_API_KEY ?? process.env.GNANI_ASR_API_KEY;
    if (!key || key === PLACEHOLDER || key.startsWith("REPLACE_WITH"))
        return undefined;
    return key;
}
function gnaniHost() {
    const raw = process.env.GNANI_API_BASE ?? "api.vachana.ai";
    return raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}
function asrModel() {
    return process.env.GNANI_ASR_MODEL ?? "prisma-v3.0";
}
function asrLanguage() {
    // Realtime accepts exactly ONE locale; comma lists are rejected.
    return process.env.GNANI_ASR_LANGUAGE ?? "hi-IN";
}
function asrFormat() {
    // "transliterate" Romanizes Hinglish so compliance/intent regexes match.
    return process.env.GNANI_ASR_FORMAT ?? "transliterate";
}
function asrBatchFormat() {
    // Batch accepts only verbatim | transcribe | codemix — never transliterate.
    const fmt = asrFormat();
    if (fmt === "transliterate")
        return process.env.GNANI_ASR_BATCH_FORMAT ?? "codemix";
    return process.env.GNANI_ASR_BATCH_FORMAT ?? fmt;
}
function asrSampleRate() {
    return Number(process.env.GNANI_ASR_SAMPLE_RATE ?? 16000);
}
async function gnaniAsrStream(cb) {
    const key = gnaniKey();
    if (!key) {
        console.warn("[asr] No Gnani API key configured — using mock streaming ASR");
        return mockAsr(cb);
    }
    try {
        // Prisma v3.0 realtime: all config is passed as WebSocket upgrade headers.
        const url = `wss://${gnaniHost()}/stt/v3/stream`;
        const ws = new ws_1.default(url, {
            headers: {
                "x-api-key-id": key,
                model: asrModel(),
                language_code: asrLanguage(),
                format: asrFormat(),
                "x-sample-rate": String(asrSampleRate()),
            },
        });
        ws.on("message", (data) => {
            try {
                const evt = JSON.parse(data.toString());
                if (evt.type === "transcript") {
                    const text = evt.text ?? "";
                    if (!text)
                        return;
                    // Prisma v3.0 streaming returns no diarization — the cockpit mic is
                    // the agent, so fall back to "agent" when no speaker is present.
                    const speaker = evt.speaker === "customer" || evt.speaker === 1
                        ? "customer"
                        : "agent";
                    cb.onFinal(text, typeof evt.confidence === "number" ? evt.confidence : 0.95, speaker);
                }
                else if (evt.type === "error") {
                    console.warn("[asr] stream error:", evt.message);
                }
                // connected / processing / speech_start / settings_updated: no transcript yet
            }
            catch (e) {
                /* ignore invalid frame */
            }
        });
        ws.on("error", (e) => console.error("[asr] ws error:", e.message));
        // Gnani requires exactly 1024-byte PCM frames (512 samples); the cockpit
        // emits 8192-byte blocks, so chunk them and keep any odd remainder.
        const FRAME_BYTES = 1024;
        let carry = Buffer.alloc(0);
        return {
            sendAudio: (pcm) => {
                if (ws.readyState !== ws_1.default.OPEN)
                    return;
                const buf = carry.length ? Buffer.concat([carry, pcm]) : pcm;
                let offset = 0;
                while (buf.length - offset >= FRAME_BYTES) {
                    ws.send(buf.subarray(offset, offset + FRAME_BYTES));
                    offset += FRAME_BYTES;
                }
                carry = offset < buf.length ? Buffer.from(buf.subarray(offset)) : Buffer.alloc(0);
            },
            close: () => ws.close(),
        };
    }
    catch (err) {
        console.warn("[asr] Error connecting to Gnani stream, falling back to mock:", err);
        return mockAsr(cb);
    }
}
function mockAsr(cb) {
    let counter = 0;
    const mockPhrases = [
        { text: "Good afternoon Mr. Sharma, this call is being recorded for quality and training purposes.", speaker: "agent" },
        { text: "Can you please verify your date of birth and last 4 digits of your card?", speaker: "agent" },
        { text: "Yes, I am calling about unblock charges and fees. Kitne paise lagenge?", speaker: "customer" },
        { text: "Sir, if your annual spend is above 1 lakh, unblock charges will be waived.", speaker: "agent" },
        { text: "Kab tak unblock ho jayega? What is the TAT?", speaker: "customer" },
        { text: "Aapka card 24 working hours ke andar unblock ho jayega and SMS notification will be sent.", speaker: "agent" },
    ];
    return {
        sendAudio: (_pcm) => {
            counter++;
            // Every ~15 frames (1.5 seconds) emit a mock response in live test if no real key
            if (counter % 15 === 0) {
                const idx = Math.floor((counter / 15) - 1) % mockPhrases.length;
                const p = mockPhrases[idx];
                cb.onPartial(p.text.slice(0, Math.floor(p.text.length / 2)), 0.85, p.speaker);
                setTimeout(() => {
                    cb.onFinal(p.text, 0.98, p.speaker);
                }, 300);
            }
        },
        close: () => { },
    };
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// The API rate-limits with 429 and sends no Retry-After — back off and retry.
async function batchFetch(url, init, attempts = 5) {
    let last;
    for (let i = 0; i < attempts; i++) {
        if (i > 0) {
            const backoff = 3000 * i;
            console.warn(`[asr] 429 rate limited, retrying in ${backoff}ms (${url})`);
            await sleep(backoff);
        }
        last = await fetch(url, init);
        if (last.status !== 429)
            return last;
    }
    return last;
}
const BATCH_TERMINAL_STATUSES = new Set([
    "COMPLETED",
    "PARTIAL_FAILURE",
    "FAILED",
    "START_FAILED",
    "CANCELLED",
]);
async function gnaniAsrBatch(audioBuffer, speakerCount, maxDurationS) {
    const key = gnaniKey();
    if (!key) {
        console.warn("[asr] No Gnani API key — returning benchmark BFSI sample transcript");
        return [];
    }
    try {
        const base = `https://${gnaniHost()}`;
        const config = {
            model: asrModel(),
            language_code: asrLanguage(),
            format: asrBatchFormat(),
            mode: "transcribe",
            with_diarization: true,
            num_speakers: Math.min(8, Math.max(1, speakerCount || 2)),
        };
        // 1) Create job (multipart upload).
        // NOTE: send `config` as a plain string — a Blob part makes the server 500.
        const form = new FormData();
        form.append("config", JSON.stringify(config));
        form.append("files", new Blob([new Uint8Array(audioBuffer)], { type: "audio/wav" }), "call.wav");
        const createRes = await batchFetch(`${base}/stt/v3/batch/jobs`, {
            method: "POST",
            headers: { "X-API-Key-ID": key },
            body: form,
        });
        if (!createRes.ok) {
            throw new Error(`create job failed: HTTP ${createRes.status} ${await createRes.text()}`);
        }
        const created = await createRes.json();
        const jobId = created.job_id;
        if (!jobId)
            throw new Error("create job returned no job_id");
        // 2) Start job
        const startRes = await batchFetch(`${base}/stt/v3/batch/jobs/${jobId}/start`, {
            method: "POST",
            headers: { "X-API-Key-ID": key },
        });
        if (!startRes.ok && startRes.status !== 409) {
            throw new Error(`start job failed: HTTP ${startRes.status} ${await startRes.text()}`);
        }
        // 3) Poll status (docs: no faster than every 10s)
        const deadline = Date.now() + Math.max(60_000, maxDurationS * 2000);
        let status = "";
        while (Date.now() < deadline) {
            await sleep(10_000);
            const statusRes = await batchFetch(`${base}/stt/v3/batch/jobs/${jobId}`, {
                headers: { "X-API-Key-ID": key },
            });
            if (!statusRes.ok)
                throw new Error(`job status failed: HTTP ${statusRes.status}`);
            const st = await statusRes.json();
            status = st.status;
            if (BATCH_TERMINAL_STATUSES.has(status))
                break;
        }
        if (!BATCH_TERMINAL_STATUSES.has(status)) {
            throw new Error(`batch job timed out (last status: ${status || "unknown"})`);
        }
        if (status !== "COMPLETED" && status !== "PARTIAL_FAILURE") {
            throw new Error(`batch job ended as ${status}`);
        }
        // 4) List completed files, then download each transcript URL
        const filesRes = await batchFetch(`${base}/stt/v3/batch/jobs/${jobId}/files?status=COMPLETED`, {
            headers: { "X-API-Key-ID": key },
        });
        if (!filesRes.ok)
            throw new Error(`job files failed: HTTP ${filesRes.status}`);
        const files = await filesRes.json();
        const raw = [];
        for (const f of files.data ?? []) {
            if (!f.transcript_url)
                continue;
            const doc = await (await batchFetch(f.transcript_url, {})).json();
            for (const seg of doc.segments ?? []) {
                const text = seg.text ?? "";
                if (!text)
                    continue;
                raw.push({
                    at_s: Number(seg.start_time ?? 0),
                    sid: Number(seg.speaker_id ?? 0),
                    text,
                    confidence: typeof seg.confidence === "number" ? seg.confidence : 0.95,
                });
            }
        }
        raw.sort((a, b) => a.at_s - b.at_s);
        // BFSI calls open with the agent: first voice heard = agent, rest = customer.
        // (Diarization ids are not stable across models — 0-based or 1-based.)
        const roleBySid = new Map();
        return raw.map((r) => {
            if (!roleBySid.has(r.sid)) {
                roleBySid.set(r.sid, roleBySid.size === 0 ? "agent" : "customer");
            }
            return { at_s: r.at_s, speaker: roleBySid.get(r.sid), text: r.text, confidence: r.confidence };
        });
    }
    catch (e) {
        console.error("[asr] Batch ASR error:", e.message);
        return [];
    }
}
