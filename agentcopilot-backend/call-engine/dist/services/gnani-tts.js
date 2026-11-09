"use strict";
// ---------------------------------------------------------------------------
// Gnani Text-to-Speech (Timbre) — SAME GNANI_API_KEY as STT.
// Env vars are read lazily so dotenv can run after this module is imported.
// Docs: https://docs.gnani.ai/api/TTS/tts-inference.md
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.synthesizeTts = synthesizeTts;
const PLACEHOLDER = "REPLACE_WITH_YOUR_GNANI_KEY";
function gnaniKey() {
    const key = process.env.GNANI_API_KEY ?? process.env.GNANI_TTS_API_KEY;
    if (!key || key === PLACEHOLDER || key.startsWith("REPLACE_WITH"))
        return undefined;
    return key;
}
function gnaniHost() {
    const raw = process.env.GNANI_API_BASE ?? "api.vachana.ai";
    return raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}
function ttsModel() {
    return process.env.GNANI_TTS_MODEL ?? "timbre-v3.0";
}
function ttsVoice() {
    return process.env.GNANI_TTS_VOICE ?? "Shivani";
}
function ttsLanguage() {
    return process.env.GNANI_TTS_LANGUAGE ?? "auto";
}
function ttsSpeed() {
    return Number(process.env.GNANI_TTS_SPEED ?? 1.0);
}
// Minimal valid silent MP3 frame (MPEG 1 Layer III, 128 kbps, 44.1 kHz, mono)
const SILENT_MP3_FRAME = Buffer.from([
    0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
async function synthesizeTts(text) {
    const key = gnaniKey();
    if (!key) {
        console.warn("[tts] No Gnani API key — returning mock silent audio");
        return SILENT_MP3_FRAME;
    }
    try {
        const res = await fetch(`https://${gnaniHost()}/api/v1/tts/inference`, {
            method: "POST",
            headers: {
                "X-API-Key-ID": key,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                text,
                voice: ttsVoice(),
                model: ttsModel(),
                language: ttsLanguage(),
                speed: ttsSpeed(),
                audio_config: {
                    container: "mp3",
                    sample_rate: 24000,
                    num_channels: 1,
                    sample_width: 2,
                    bitrate: "128k",
                },
            }),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            console.warn(`[tts] Gnani TTS responded with HTTP ${res.status}: ${body.slice(0, 300)}`);
            return SILENT_MP3_FRAME;
        }
        return Buffer.from(await res.arrayBuffer());
    }
    catch (err) {
        console.error("[tts] Error calling Gnani TTS:", err.message);
        return SILENT_MP3_FRAME;
    }
}
