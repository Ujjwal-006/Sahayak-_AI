// ---------------------------------------------------------------------------
// Gnani Text-to-Speech (Timbre) — SAME GNANI_API_KEY as STT.
// Env vars are read lazily so dotenv can run after this module is imported.
// Docs: https://docs.gnani.ai/api/TTS/tts-inference.md
// ---------------------------------------------------------------------------

const PLACEHOLDER = "REPLACE_WITH_YOUR_GNANI_KEY";

function gnaniKey(): string | undefined {
  const key = process.env.GNANI_API_KEY ?? process.env.GNANI_TTS_API_KEY;
  if (!key || key === PLACEHOLDER || key.startsWith("REPLACE_WITH")) return undefined;
  return key;
}

function gnaniHost(): string {
  const raw = process.env.GNANI_API_BASE ?? "api.vachana.ai";
  return raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function ttsModel(): string {
  return process.env.GNANI_TTS_MODEL ?? "timbre-v3.0";
}

function ttsVoice(): string {
  return process.env.GNANI_TTS_VOICE ?? "Shivani";
}

function ttsLanguage(): string {
  return process.env.GNANI_TTS_LANGUAGE ?? "auto";
}

// Per-call overrides: language code (from translate.ts) -> Gnani voice + locale.
// Fall back to env defaults when a code is unknown.
export function voiceForLanguage(language?: string): string | undefined {
  if (!language || language === "en") return ttsVoice();
  const map: Record<string, string | undefined> = {
    hi: process.env.GNANI_TTS_VOICE_HI,
    te: process.env.GNANI_TTS_VOICE_TE,
    ta: process.env.GNANI_TTS_VOICE_TA,
    bn: process.env.GNANI_TTS_VOICE_BN,
    mr: process.env.GNANI_TTS_VOICE_MR,
    gu: process.env.GNANI_TTS_VOICE_GU,
    kn: process.env.GNANI_TTS_VOICE_KN,
    ml: process.env.GNANI_TTS_VOICE_ML,
    pa: process.env.GNANI_TTS_VOICE_PA,
    ur: process.env.GNANI_TTS_VOICE_UR,
  };
  const mapped = language === "hinglish" ? map.hi : map[language];
  return mapped && !mapped.startsWith("REPLACE_WITH") ? mapped : ttsVoice();
}

export function localeForLanguage(language?: string): string {
  if (!language || language === "en" || language === "hinglish") {
    return ttsLanguage();
  }
  const countries: Record<string, string> = {
    hi: "IN", bn: "BD", ta: "IN", te: "IN", mr: "IN",
    gu: "IN", kn: "IN", ml: "IN", pa: "IN", ur: "PK",
  };
  const c = countries[language];
  return c ? `${language}-${c}` : language;
}

function ttsSpeed(): number {
  return Number(process.env.GNANI_TTS_SPEED ?? 1.0);
}

// Minimal valid silent MP3 frame (MPEG 1 Layer III, 128 kbps, 44.1 kHz, mono)
const SILENT_MP3_FRAME = Buffer.from([
  0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

export type TtsOptions = { voice?: string; language?: string };

export async function synthesizeTts(
  text: string,
  opts?: TtsOptions
): Promise<Buffer> {
  const key = gnaniKey();
  if (!key) {
    console.warn("[tts] No Gnani API key — returning mock silent audio");
    return SILENT_MP3_FRAME;
  }

  const voice = opts?.voice ?? voiceForLanguage(opts?.language);
  const language = localeForLanguage(opts?.language);

  try {
    const res = await fetch(`https://${gnaniHost()}/api/v1/tts/inference`, {
      method: "POST",
      headers: {
        "X-API-Key-ID": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        voice,
        model: ttsModel(),
        language,
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
  } catch (err: any) {
    console.error("[tts] Error calling Gnani TTS:", err.message);
    return SILENT_MP3_FRAME;
  }
}
