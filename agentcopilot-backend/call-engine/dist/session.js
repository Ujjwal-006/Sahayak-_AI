"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CallSession = void 0;
exports.detectIntent = detectIntent;
const gnani_asr_1 = require("./services/gnani-asr");
const gnani_tts_1 = require("./services/gnani-tts");
const llm_1 = require("./services/llm");
const compliance_1 = require("./compliance");
const kb_1 = require("./kb");
const analytics_1 = require("./analytics");
const sample_loader_1 = require("./sample-loader");
const AGENT_NAME = "Priya Sharma";
const DEFAULT_CUSTOMER = {
    name: "Rajesh Sharma",
    phone: "+91 ••••• ••210",
    card_last4: "4581",
};
function detectIntent(text) {
    const t = text.toLowerCase();
    const wantsTat = /\btat\b|\bturnaround\b|\btime\b|\bkab\b|\bhow\s+long\b|\bwhen\b|\bworking\s+(hours?|days?)\b|\bkitna\s+(time|der|din|ghanta|ghante)\b|\breplacement\b|\bnotification\b|\bsms\b/.test(t);
    const wantsFee = /\bcharges?\b|\bfees?\b|\bpaise\b|\bpaisa\b|\brupees?\b|₹|\brs\.?\b|\blagenge\b|\blagega\b|\bannual\b|\bmaintenance\b|\bwaiver\b|\breverse\b|\b250\b/.test(t);
    if (wantsTat && !wantsFee)
        return "card.unblock_tat";
    if (wantsFee && !wantsTat)
        return "card.unblock_fees";
    if (wantsTat && wantsFee)
        return "card.unblock_tat";
    if (/record(ed|ing)|quality|training|monitored/.test(t)) {
        return "call.opening_disclosure";
    }
    if (/kyc|identity|verify|date of birth|dob|otp|last (4|four)/.test(t)) {
        return "kyc.verify_identity";
    }
    return null;
}
class CallSession {
    socket;
    mode;
    sampleId;
    durationSec;
    timeScale = 1.0;
    callId;
    seq = 0;
    openTurns = new Map();
    t0 = Date.now();
    cancelled = false;
    finished = false;
    engine = new compliance_1.ComplianceEngine();
    tracker = new analytics_1.TimelineTracker();
    asrStream;
    customer = DEFAULT_CUSTOMER;
    language = "Hinglish";
    constructor(socket, mode) {
        this.socket = socket;
        this.mode = mode;
        this.callId = `call_${Math.floor(1000 + Math.random() * 9000)}`;
    }
    emit(event) {
        this.socket.emit("agent-event", event);
    }
    seqFor(speaker, isFinal) {
        if (isFinal) {
            const open = this.openTurns.get(speaker);
            if (open != null) {
                this.openTurns.delete(speaker);
                return open;
            }
            return ++this.seq;
        }
        const open = this.openTurns.get(speaker);
        if (open != null)
            return open;
        const next = ++this.seq;
        this.openTurns.set(speaker, next);
        return next;
    }
    async run() {
        // LIVE mode - connect to Gnani Prisma streaming ASR
        this.emitCallStarted();
        this.emitInitialChecklist();
        try {
            this.asrStream = await (0, gnani_asr_1.gnaniAsrStream)({
                onPartial: (text, conf, speaker) => this.onPartial(text, conf, speaker),
                onFinal: (text, conf, speaker) => this.onFinal(text, conf, speaker),
            });
        }
        catch (err) {
            console.error("[session] Failed to initialize ASR stream:", err);
        }
    }
    async runSample() {
        // DEMO mode - play pre-loaded sample
        this.emitCallStarted();
        this.emitInitialChecklist();
        const sample = await (0, sample_loader_1.loadSample)(this.sampleId || "Sample - 01", this.durationSec ?? 90);
        const wavFiles = (0, sample_loader_1.getSampleAudioFiles)(this.sampleId || "Sample - 01");
        let i = 0;
        const startMs = Date.now();
        // Start background VU meter pulses while call is active
        const vuInterval = setInterval(() => {
            if (this.cancelled || this.finished) {
                clearInterval(vuInterval);
                return;
            }
            const speaker = i < sample.transcript.length ? sample.transcript[i]?.speaker : "agent";
            this.emit({
                event_type: "AUDIO_LEVEL",
                call_id: this.callId,
                payload: {
                    level: Math.round(-12 - Math.random() * 14),
                    speaker: speaker || "agent",
                },
            });
        }, 400);
        while (i < sample.transcript.length && !this.cancelled) {
            const entry = sample.transcript[i];
            const elapsed = Date.now() - startMs;
            const expectedMs = (entry.at_s * 1000) / this.timeScale;
            if (elapsed >= expectedMs) {
                // Emit partial first
                this.emit({
                    event_type: "TRANSCRIPTION_DELTA",
                    call_id: this.callId,
                    latency_ms: 140 + Math.floor(Math.random() * 60),
                    payload: {
                        speaker: entry.speaker,
                        text: entry.text,
                        confidence: entry.confidence,
                        is_final: false,
                        seq: this.seqFor(entry.speaker, false),
                    },
                });
                // Emit final 200ms later
                await this.sleep(Math.max(50, 200 / this.timeScale));
                if (this.cancelled)
                    break;
                this.emit({
                    event_type: "TRANSCRIPTION_DELTA",
                    call_id: this.callId,
                    latency_ms: 160 + Math.floor(Math.random() * 50),
                    payload: {
                        speaker: entry.speaker,
                        text: entry.text,
                        confidence: entry.confidence,
                        is_final: true,
                        seq: this.seqFor(entry.speaker, true),
                    },
                });
                const wavFile = entry.speaker === "customer" ? wavFiles[1] ?? wavFiles[0] : wavFiles[0];
                if (wavFile) {
                    this.socket.emit("sample-audio", {
                        call_id: this.callId,
                        sampleId: this.sampleId,
                        speaker: entry.speaker,
                        at_s: entry.at_s,
                        text: entry.text,
                        file: wavFile,
                    });
                }
                this.tracker.onUtterance(entry.speaker, entry.text, entry.at_s);
                await this.afterFinal(entry.speaker, entry.text);
                i++;
            }
            else {
                await this.sleep(50);
            }
        }
        clearInterval(vuInterval);
        if (!this.cancelled)
            await this.sleep(500);
        await this.finish();
    }
    feedAudio(pcm) {
        if (this.asrStream) {
            this.asrStream.sendAudio(pcm);
        }
        // Also emit audio level for live mode VU meters
        this.emit({
            event_type: "AUDIO_LEVEL",
            call_id: this.callId,
            payload: {
                level: Math.round(-14 - Math.random() * 12),
                speaker: "agent",
            },
        });
    }
    async onPartial(text, conf, speakerHint) {
        const speaker = speakerHint ?? "agent";
        this.emit({
            event_type: "TRANSCRIPTION_DELTA",
            call_id: this.callId,
            latency_ms: 140 + Math.floor(Math.random() * 60),
            payload: {
                speaker,
                text,
                confidence: conf,
                is_final: false,
                seq: this.seqFor(speaker, false),
            },
        });
    }
    async onFinal(text, conf, speakerHint) {
        const speaker = speakerHint ?? "agent";
        this.emit({
            event_type: "TRANSCRIPTION_DELTA",
            call_id: this.callId,
            latency_ms: 160 + Math.floor(Math.random() * 50),
            payload: {
                speaker,
                text,
                confidence: conf,
                is_final: true,
                seq: this.seqFor(speaker, true),
            },
        });
        this.tracker.onUtterance(speaker, text, (Date.now() - this.t0) / 1000);
        await this.afterFinal(speaker, text);
    }
    async afterFinal(speaker, text) {
        // 1) Compliance engine evaluates the final text
        for (const sig of this.engine.onTranscript(speaker, text)) {
            await this.sleep(50);
            this.emit({
                event_type: "COMPLIANCE_SIGNAL",
                call_id: this.callId,
                latency_ms: 70 + Math.floor(Math.random() * 50),
                payload: sig,
            });
        }
        // 2) Knowledge trigger (if customer asked a question)
        if (speaker === "customer") {
            const trigger = this.detectIntent(text);
            if (trigger) {
                await this.surfaceKnowledge(text, trigger);
            }
        }
    }
    detectIntent(text) {
        return detectIntent(text);
    }
    async surfaceKnowledge(query, intent) {
        const t0 = Date.now();
        const hit = (0, kb_1.ragSearch)(query, intent);
        let recommendation;
        if (hit) {
            // Synthesize answer using selected LLM (Gemini / OpenAI / Evon)
            const llmResult = await (0, llm_1.llmSynthesizeAnswer)(query, hit.doc).catch(() => null);
            recommendation = {
                title: hit.title,
                direct_answer: llmResult?.answer ?? hit.doc,
                kb_article_id: hit.kb_id,
            };
        }
        else {
            recommendation = {
                title: "No KB match",
                direct_answer: "I'm not sure — let me check with my supervisor.",
                kb_article_id: "KB-NA",
            };
        }
        const latencyMs = Date.now() - t0;
        this.emit({
            event_type: "KNOWLEDGE_SURFACED",
            call_id: this.callId,
            latency_ms: latencyMs,
            payload: {
                intent,
                primary_recommendation: recommendation,
                suggested_quick_reply: this.quickReplyFor(intent),
            },
        });
    }
    quickReplyFor(intent) {
        const replies = {
            "card.unblock_fees": "Sir, unblock charges are ₹250 + GST, but agar aapka annual spend 1 lakh se upar hai toh charges waive ho jayenge.",
            "card.unblock_tat": "Aapka card 24 working hours ke andar unblock ho jayega, aur aapko confirmation SMS bhi milega.",
            "call.opening_disclosure": "This call is being recorded for quality and regulatory training purposes.",
            "kyc.verify_identity": "Please verify your date of birth and the last 4 digits of your card for security.",
        };
        return replies[intent] ?? "Let me check that for you right away.";
    }
    injectReply(text) {
        if (this.finished || this.cancelled)
            return;
        // Emit the agent utterance as a final transcript
        this.emit({
            event_type: "TRANSCRIPTION_DELTA",
            call_id: this.callId,
            latency_ms: 80,
            payload: {
                speaker: "agent",
                text,
                confidence: 0.99,
                is_final: true,
                seq: ++this.seq,
                source: "injected",
            },
        });
        this.tracker.onUtterance("agent", text, (Date.now() - this.t0) / 1000);
        // Re-run compliance on the inserted reply
        for (const sig of this.engine.onTranscript("agent", text)) {
            this.emit({
                event_type: "COMPLIANCE_SIGNAL",
                call_id: this.callId,
                latency_ms: 60,
                payload: sig,
            });
        }
    }
    simulateCustomer(text) {
        if (this.finished || this.cancelled)
            return;
        this.emit({
            event_type: "TRANSCRIPTION_DELTA",
            call_id: this.callId,
            latency_ms: 90,
            payload: {
                speaker: "customer",
                text,
                confidence: 0.97,
                is_final: true,
                seq: ++this.seq,
            },
        });
        this.tracker.onUtterance("customer", text, (Date.now() - this.t0) / 1000);
        this.afterFinal("customer", text).catch(() => { });
    }
    async synthesize(text, requestId) {
        try {
            const mp3 = await (0, gnani_tts_1.synthesizeTts)(text);
            if (!mp3 || mp3.length < 100) {
                console.warn("[tts] server TTS unavailable; browser fallback will speak instead");
                this.socket.emit("tts-status", { requestId, status: "failed", reason: "unavailable" });
                return;
            }
            this.socket.emit("tts-audio", mp3.buffer);
            this.socket.emit("tts-status", { requestId, status: "ok" });
        }
        catch (e) {
            console.error("[tts]", e);
            this.socket.emit("tts-status", { requestId, status: "failed", reason: "error" });
        }
    }
    requestEnd() {
        this.cancelled = true;
        if (this.asrStream) {
            this.asrStream.close();
        }
        this.finish().catch(console.error);
    }
    emitCallStarted() {
        this.emit({
            event_type: "CALL_STARTED",
            call_id: this.callId,
            payload: {
                customer_name: this.customer.name,
                phone_masked: this.customer.phone,
                script_name: this.mode === "demo" ? `sample:${this.sampleId}` : "live_call",
                language: this.language,
            },
        });
    }
    emitInitialChecklist() {
        this.emit({
            event_type: "COMPLIANCE_SIGNAL",
            call_id: this.callId,
            latency_ms: 50,
            payload: {
                rule_id: "INIT",
                status: "PENDING",
                checklist: this.engine.checklist(),
            },
        });
    }
    async finish() {
        if (this.finished)
            return;
        this.finished = true;
        // Force-resolve pending rules
        for (const sig of this.engine.finalize()) {
            this.emit({
                event_type: "COMPLIANCE_SIGNAL",
                call_id: this.callId,
                latency_ms: 45,
                payload: sig,
            });
        }
        const metrics = this.tracker.computeMetrics();
        const complianceScore = this.engine.score();
        const summary = {
            duration_s: this.tracker.durationS() || 90.0,
            bullets: this.buildBullets(),
            disposition: "Card Services → Unblock Request — Resolved",
            metrics: {
                talk_listen_ratio: metrics.talk_listen_ratio,
                dead_air_pct: metrics.dead_air_pct,
                compliance_score: complianceScore,
                sentiment_from: "Neutral",
                sentiment_to: complianceScore >= 80 ? "Positive" : "Strained",
            },
            crm: {
                customer_name: this.customer.name,
                phone_masked: this.customer.phone,
                card_last4: this.customer.card_last4,
                category: "Card Services",
                subcategory: "Block / Unblock",
                resolution: "Fee waiver applied; unblock request raised, TAT 24h",
                follow_up_required: complianceScore < 80,
                notes: "Customer reported blocked card. Identity verified. Fee waiver confirmed. Unblock request raised with 24h TAT.",
            },
        };
        this.emit({
            event_type: "CALL_SUMMARY",
            call_id: this.callId,
            payload: summary,
        });
        // Persist to SaaS backend
        const record = {
            call_id: this.callId,
            agent: AGENT_NAME,
            customer_masked: this.customer.name,
            date: new Date().toISOString(),
            duration_s: summary.duration_s,
            talk_listen_ratio: metrics.talk_listen_ratio,
            dead_air_pct: metrics.dead_air_pct,
            compliance_score: complianceScore,
            disposition: summary.disposition,
            escalated: this.engine.failedCritical(),
            language: this.language,
        };
        this.socket.emit("qa-call-scored", record);
        // Broadcast to all sockets so supervisor views update in real-time
        this.socket.broadcast?.emit("qa-call-scored", record);
        await this.persistToSaas(record).catch((e) => console.warn("[session] Persist to SaaS backend failed:", e.message));
    }
    async persistToSaas(record) {
        const saasPort = process.env.SAAS_BACKEND_PORT ?? "4000";
        await fetch(`http://127.0.0.1:${saasPort}/api/ingest/call`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(record),
        });
    }
    buildBullets() {
        return [
            "Customer reported blocked credit card and asked for unblock charges.",
            "Identity verified via DOB + card last-4; fee waiver confirmed.",
            "Unblock request raised; 24-working-hour TAT communicated and accepted.",
        ];
    }
    sleep(ms) {
        return new Promise((resolve) => {
            const start = Date.now();
            const tick = () => {
                if (this.cancelled || Date.now() - start >= ms)
                    return resolve();
                setTimeout(tick, 50);
            };
            tick();
        });
    }
}
exports.CallSession = CallSession;
