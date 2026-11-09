import { EventEmitter } from "events";
import { gnaniAsrStream, AsrStreamHandle } from "./services/gnani-asr";
import { synthesizeTts } from "./services/gnani-tts";
import { llmSynthesizeAnswer } from "./services/llm";
import {
  detectAndTranslateToEnglish,
  translateForSpeech,
  type ClientLanguage,
} from "./services/translate";
import { ComplianceEngine } from "./compliance";
import { ragSearch } from "./kb";
import { TimelineTracker } from "./analytics";
import { loadSample, getSampleAudioFiles } from "./sample-loader";
import type { AgentEvent, QaCallRecord } from "./events";

const AGENT_NAME = "Priya Sharma";
const DEFAULT_CUSTOMER = {
  name: "Rajesh Sharma",
  phone: "+91 throwable210",
  card_last4: "4581",
};

function rmsDbfs(pcm: Buffer): number {
  const n = Math.floor(pcm.length / 2);
  if (n === 0) return -60;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = pcm.readInt16LE(i * 2) / 32768;
    sum += s * s;
  }
  const rms = Math.sqrt(sum / n);
  return rms > 0 ? Math.max(-60, 20 * Math.log10(rms)) : -60;
}

export function detectIntent(text: string): string | null {
  const t = text.toLowerCase();
  const wantsTat =
    /\btat\b|\bturnaround\b|\btime\b|\bkab\b|\bhow\s+long\b|\bwhen\b|\bworking\s+(hours?|days?)\b|\bkitna\s+(time|der|din|ghanta|ghante)\b|\breplacement\b|\bnotification\b|\bsms\b/.test(
      t
    );
  const wantsFee =
    /\bcharges?\b|\bfees?\b|\bpaise\b|\bpaisa\b|\brupees?\b|₹|\brs\.?\b|\blagenge\b|\blagega\b|\bannual\b|\bmaintenance\b|\bwaiver\b|\breverse\b|\b250\b/.test(
      t
    );
  if (wantsTat && !wantsFee) return "card.unblock_tat";
  if (wantsFee && !wantsTat) return "card.unblock_fees";
  if (wantsTat && wantsFee) return "card.unblock_tat";
  if (/record(ed|ing)|quality|training|monitored/.test(t)) {
    return "call.opening_disclosure";
  }
  if (/kyc|identity|verify|date of birth|dob|otp|last (4|four)/.test(t)) {
    return "kyc.verify_identity";
  }
  return null;
}

export class CallSession {
  socket: any;
  mode: "live" | "demo";
  sampleId?: string;
  durationSec?: number;
  timeScale: number = 1.0;

  callId: string;
  seq = 0;
  private openTurns = new Map<string, number>();
  t0 = Date.now();
  cancelled = false;
  finished = false;

  engine = new ComplianceEngine();
  tracker = new TimelineTracker();

  asrStream?: AsrStreamHandle;
  customer = DEFAULT_CUSTOMER;
  language = "Hinglish";
  // Double-transcription guard: Web Speech (cockpit) and the Gnani ASR stream
  // may both finalize the same spoken sentence within ~3s. Keep recent finals
  // and drop near-identical repeats so Gemini is not called twice.
  private recentCustomerFinals: Array<{ text: string; at: number }> = [];
  private lastVuEmitAt = 0;
  // Echo gate: while the agent TTS voice is (or may be) playing on the client's
  // speakers, customer finals are typically the agent's own voice bleeding back
  // through the mic. Drop them for a duration-estimated window.
  private micGateUntil = 0;
  clientLanguage: ClientLanguage = {
    language: "xx",
    languageLabel: "English (assumed)",
    english: "",
    translated: false,
  };

  constructor(socket: any, mode: "live" | "demo") {
    this.socket = socket;
    this.mode = mode;
    this.callId = `call_${Math.floor(1000 + Math.random() * 9000)}`;
  }

  private emit(event: AgentEvent) {
    this.socket.emit("agent-event", event);
  }

  private seqFor(speaker: string, isFinal: boolean): number {
    if (isFinal) {
      const open = this.openTurns.get(speaker);
      if (open != null) {
        this.openTurns.delete(speaker);
        return open;
      }
      return ++this.seq;
    }
    const open = this.openTurns.get(speaker);
    if (open != null) return open;
    const next = ++this.seq;
    this.openTurns.set(speaker, next);
    return next;
  }

  async run() {
    // LIVE mode - connect to Gnani Prisma streaming ASR
    this.emitCallStarted();
    this.emitInitialChecklist();
    // Gnani streaming has no diarization; in live-mic demos the person at the
    // microphone plays the client. Override with GNANI_ASR_DEFAULT_SPEAKER=agent.
    const defaultSpeaker =
      process.env.GNANI_ASR_DEFAULT_SPEAKER === "agent" ? "agent" : "customer";
    try {
      this.asrStream = await gnaniAsrStream(
        {
          onPartial: (text, conf, speaker) => this.onPartial(text, conf, speaker),
          onFinal: (text, conf, speaker) => this.onFinal(text, conf, speaker),
        },
        { defaultSpeaker }
      );
    } catch (err) {
      console.error("[session] Failed to initialize ASR stream:", err);
    }
  }

  async runSample() {
    // DEMO mode - play pre-loaded sample
    this.emitCallStarted();
    this.emitInitialChecklist();

    const sample = await loadSample(this.sampleId || "Sample - 01", this.durationSec ?? 90);
    const wavFiles = getSampleAudioFiles(this.sampleId || "Sample - 01");
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
        if (this.cancelled) break;

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

        const wavFile =
          entry.speaker === "customer" ? wavFiles[1] ?? wavFiles[0] : wavFiles[0];
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
      } else {
        await this.sleep(50);
      }
    }

    clearInterval(vuInterval);
    if (!this.cancelled) await this.sleep(500);
    await this.finish();
  }

  feedAudio(pcm: Buffer) {
    if (this.asrStream) {
      this.asrStream.sendAudio(pcm);
    }
    // Live VU meters: the person at the mic plays the client (matches the ASR
    // defaultSpeaker), so the REAL mic RMS drives that channel and the other
    // channel is kept animated for the demo. Throttled to ~5 pairs/sec.
    const now = Date.now();
    if (now - this.lastVuEmitAt < 200) return;
    this.lastVuEmitAt = now;
    const dbfs = rmsDbfs(pcm);
    const speaking = dbfs > -35;
    const micSpeaker =
      process.env.GNANI_ASR_DEFAULT_SPEAKER === "agent" ? "agent" : "customer";
    this.emitAudioLevel(dbfs, micSpeaker);
    this.emitAudioLevel(
      speaking ? -14 - Math.random() * 10 : -46 - Math.random() * 6,
      micSpeaker === "customer" ? "agent" : "customer"
    );
  }

  private emitAudioLevel(level: number, speaker: "agent" | "customer") {
    this.emit({
      event_type: "AUDIO_LEVEL",
      call_id: this.callId,
      payload: {
        level: Math.round(level * 10) / 10,
        speaker,
      },
    });
  }

  async onPartial(text: string, conf: number, speakerHint?: string) {
    const speaker = (speakerHint as any) ?? "agent";
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

  private isDuplicateCustomerFinal(text: string): boolean {
    const norm = text.trim().toLowerCase().replace(/\s+/g, " ");
    const now = Date.now();
    this.recentCustomerFinals = this.recentCustomerFinals.filter(
      (e) => now - e.at < 3000
    );
    if (this.recentCustomerFinals.some((e) => e.text === norm)) return true;
    this.recentCustomerFinals.push({ text: norm, at: now });
    return false;
  }

  async onFinal(text: string, conf: number, speakerHint?: string) {
    const speaker = (speakerHint as any) ?? "agent";
    if (speaker === "customer" && Date.now() < this.micGateUntil) {
      console.log("[session] customer final inside echo gate — suppressed:", text.slice(0, 60));
      return;
    }
    if (speaker === "customer" && this.isDuplicateCustomerFinal(text)) {
      console.log("[session] duplicate customer final suppressed:", text.slice(0, 60));
      return;
    }
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

  async afterFinal(speaker: string, text: string) {
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
      // Whitelisted intents hit the KB directly; ANY other customer utterance
      // still surfaces (general.qna) so Gemini can answer it — no silent drops.
      const intent = this.detectIntent(text) ?? "general.qna";
      await this.surfaceKnowledge(text, intent);
    }
  }

  detectIntent(text: string): string | null {
    return detectIntent(text);
  }

  async surfaceKnowledge(rawQuery: string, intent: string) {
    // ── Multilingual pipeline ────────────────────────────────────────────────
    // Stage T: detect customer language + translate question to English
    const tTranslate = Date.now();
    let detected: ClientLanguage = {
      language: "xx",
      languageLabel: "English (assumed)",
      english: rawQuery,
      translated: false,
    };
    try {
      detected = await detectAndTranslateToEnglish(rawQuery);
    } catch {
      /* keep pass-through */
    }
    const translateMs = Date.now() - tTranslate;
    if (detected.translated) {
      this.language = detected.languageLabel; // QA record reflects client language
      this.clientLanguage = detected;
    }

    // Stage L: KB retrieval + LLM synthesis on the ENGLISH question
    const tLlm = Date.now();
    const query = detected.english;
    const hit = ragSearch(query, intent);
    let recommendation;

    if (hit) {
      // Synthesize answer using selected LLM (Gemini / OpenAI / Evon)
      const llmResult = await llmSynthesizeAnswer(query, hit.doc).catch(() => null);
      recommendation = {
        title: hit.title,
        direct_answer: llmResult?.answer ?? hit.doc,
        kb_article_id: hit.kb_id,
      };
    } else {
      // No KB doc matched — ask the LLM in general Q&A mode (safe prompt):
      // it answers politely and never invents account-specific data.
      const general = await llmSynthesizeAnswer(query, "").catch(() => null);
      const generalAnswer = (general?.answer ?? "").trim();
      recommendation = {
        title: "General Q&A (no KB article)",
        direct_answer:
          generalAnswer || "I'm not sure — let me check with my supervisor.",
        kb_article_id: "KB-NA",
      };
    }
    const llmMs = Date.now() - tLlm;
    if (!hit) console.log(`[session] general.qna answered by LLM: "${recommendation.direct_answer.slice(0, 90)}"`);

    const latencyMs = Date.now() - tTranslate;
    this.emit({
      event_type: "KNOWLEDGE_SURFACED",
      call_id: this.callId,
      latency_ms: latencyMs,
      payload: {
        intent,
        primary_recommendation: recommendation,
        suggested_quick_reply: this.quickReplyFor(intent),
        original_query: rawQuery,
        english_query: detected.english,
        detected_language: detected.language,
        detected_language_label: detected.languageLabel,
        stage_latencies: { translate_ms: translateMs, llm_ms: llmMs },
      },
    });
  }

  quickReplyFor(intent: string): string {
    const replies: Record<string, string> = {
      "card.unblock_fees":
        "Sir, unblock charges are ₹250 + GST, but agar aapka annual spend 1 lakh se upar hai toh charges waive ho jayenge.",
      "card.unblock_tat":
        "Aapka card 24 working hours ke andar unblock ho jayega, aur aapko confirmation SMS bhi milega.",
      "call.opening_disclosure":
        "This call is being recorded for quality and regulatory training purposes.",
      "kyc.verify_identity":
        "Please verify your date of birth and the last 4 digits of your card for security.",
    };
    return replies[intent] ?? "Let me check that for you right away.";
  }

  injectReply(text: string) {
    if (this.finished || this.cancelled) return;

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

  simulateCustomer(text: string) {
    if (this.finished || this.cancelled) return;
    if (Date.now() < this.micGateUntil) {
      console.log("[session] simulated customer inside echo gate — suppressed:", text.slice(0, 60));
      return;
    }
    if (this.isDuplicateCustomerFinal(text)) {
      console.log("[session] duplicate simulated customer final suppressed:", text.slice(0, 60));
      return;
    }
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
    this.afterFinal("customer", text).catch(() => {});
  }

  async synthesize(text: string, requestId?: string | number, language?: string) {
    try {
      // ── Multilingual pipeline: speak in the CLIENT's language ────────────
      // English text is displayed on screen; the voice track is rendered in
      // the language the client actually spoke (English if none detected).
      const target = language && language !== "en" ? language : "en";
      const tSpeak = Date.now();
      const speechText =
        target === "en" ? text : await translateForSpeech(text, target);
      console.log(
        `[tts] speech track: lang=${target} translateMs=${Date.now() - tSpeak}`
      );

      const mp3 = await synthesizeTts(speechText, { language: target });
      if (!mp3 || mp3.length < 100) {
        console.warn("[tts] server TTS unavailable; browser fallback will speak instead");
        // Browser fallback will speak the English reply on the screen — gate on it too.
        this.openMicGate(text);
        this.socket.emit("tts-status", {
          requestId,
          status: "failed",
          reason: "unavailable",
          language: target,
        });
        return;
      }
      this.openMicGate(speechText);
      this.socket.emit("tts-audio", mp3.buffer);
      this.socket.emit("tts-status", { requestId, status: "ok", language: target });
    } catch (e) {
      console.error("[tts]", e);
      this.socket.emit("tts-status", { requestId, status: "failed", reason: "error" });
    }
  }

  // Duration-estimated echo window: ~80 ms per character plus start/stop slack.
  openMicGate(speechText: string) {
    const gateMs = Math.min(12000, Math.max(2000, speechText.length * 80 + 1000));
    this.micGateUntil = Date.now() + gateMs;
  }

  requestEnd() {
    this.cancelled = true;
    if (this.asrStream) {
      this.asrStream.close();
    }
    this.finish().catch(console.error);
  }

  private emitCallStarted() {
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

  private emitInitialChecklist() {
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

  private async finish() {
    if (this.finished) return;
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
        notes:
          "Customer reported blocked card. Identity verified. Fee waiver confirmed. Unblock request raised with 24h TAT.",
      },
    };

    this.emit({
      event_type: "CALL_SUMMARY",
      call_id: this.callId,
      payload: summary,
    });

    // Persist to SaaS backend
    const record: QaCallRecord = {
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

    await this.persistToSaas(record).catch((e) =>
      console.warn("[session] Persist to SaaS backend failed:", e.message)
    );
  }

  private async persistToSaas(record: QaCallRecord) {
    const saasPort = process.env.SAAS_BACKEND_PORT ?? "4000";
    await fetch(`http://127.0.0.1:${saasPort}/api/ingest/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });
  }

  private buildBullets(): string[] {
    return [
      "Customer reported blocked credit card and asked for unblock charges.",
      "Identity verified via DOB + card last-4; fee waiver confirmed.",
      "Unblock request raised; 24-working-hour TAT communicated and accepted.",
    ];
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (this.cancelled || Date.now() - start >= ms) return resolve();
        setTimeout(tick, 50);
      };
      tick();
    });
  }
}
