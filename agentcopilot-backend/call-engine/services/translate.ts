// ---------------------------------------------------------------------------
// Multilingual pipeline helper — powered by Gemini (same key/model as llm.ts).
//
// Pipeline position:  Gnani ASR text --> [detect + translate to English]
//                     --> KB / Gemini answer (English) --> screen
//                     --> [translate answer BACK to client language --> TTS]
//
// Design notes:
// - One Gemini call per question (combined LANG + TRANSLATION output) keeps
//   latency and free-tier quota low; one call per spoken synthesis only when
//   the target language is non-English.
// - Deterministic results are memoized to avoid repeat API cost.
// - Every failure falls back to pass-through logic (treat as English) so the
//   call never stalls.
// ---------------------------------------------------------------------------

export type ClientLanguage = {
  language: string; // short code, e.g. "hi", "en", "te" ("xx" = unknown)
  languageLabel: string; // human label, e.g. "Hindi", "English"
  english: string; // English text (pass-through when already English)
  translated: boolean;
};

type TranslateCacheEntry = ClientLanguage & { at: number };

const CACHE_TTL_MS = 10 * 60 * 1000;
const qCache = new Map<string, TranslateCacheEntry>();
const speechCache = new Map<string, { value: string; at: number }>();

function translateEnabled(): boolean {
  return process.env.TRANSLATE_ENABLED !== "0";
}

function geminiKey(): string | undefined {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.startsWith("REPLACE_WITH")) return undefined;
  return key;
}

function geminiModel(): string {
  return process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
}

function translateTimeout(): number {
  // Gemini free-tier latency varies (0.9s-6s+); default 12s so slow but
  // healthy responses are still used instead of falling back.
  return Number(process.env.TRANSLATE_TIMEOUT_MS ?? 12000);
}

async function geminiAsk(prompt: string): Promise<string | null> {
  const key = geminiKey();
  if (!key) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:generateContent?key=${key}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), translateTimeout());
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 300 },
      }),
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      console.warn(`[translate] Gemini HTTP ${res.status}`);
      return null;
    }
    const data: any = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch (e: any) {
    clearTimeout(timeoutId);
    console.warn(`[translate] Gemini call failed: ${e?.message}`);
    return null;
  }
}

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  bn: "Bengali",
  ta: "Tamil",
  te: "Telugu",
  mr: "Marathi",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
  pa: "Punjabi",
  ur: "Urdu",
  hinglish: "Hinglish",
  xx: "English (assumed)",
};

function labelFor(code: string): string {
  return LANGUAGE_LABELS[code] ?? "English";
}

// ---------------------------------------------------------------------------
// Local fallback language detection — used ONLY when Gemini is unavailable.
// Keeps the language badge and the voice-track language correct even when the
// online detector fails (translation then degrades to the original text, which
// the LLM can still handle). Unicode script ranges first (they are unambiguous
// per language except Devanagari, which we map to Hindi as the common case),
// then Romanized transliteration markers ("Tanglish"/"Hinglish") for
// ASR format=transliterate output.
// ---------------------------------------------------------------------------
const SCRIPT_RANGES: Array<[RegExp, string]> = [
  [/[\u0B80-\u0BFF]/, "ta"], // Tamil
  [/[\u0900-\u097F]/, "hi"], // Devanagari (hi/mr/pi) → Hindi
  [/[\u0980-\u09FF]/, "bn"], // Bengali
  [/[\u0A00-\u0A7F]/, "pa"], // Gurmukhi
  [/[\u0A80-\u0AFF]/, "gu"], // Gujarati
  [/[\u0C00-\u0C7F]/, "te"], // Telugu
  [/[\u0C80-\u0CFF]/, "kn"], // Kannada
  [/[\u0D00-\u0D7F]/, "ml"], // Malayalam
  [/[\u0600-\u06FF]/, "ur"], // Arabic script (Urdu)
];

const ROMAN_MARKERS: Array<[RegExp, string]> = [
  [
    /\b(eppo|eppadi|epdi|evlo|evalo|evalavu|ethukku|idhu|adhu|indha|unnga|unga|vanakkam|nandri|seri|illa|venum|aagum|aakum|panrenga|panren|pannanum|vaangi|kitta|romba|chumma|mudiyala|mudiyaathu|kandippa|kodukanum|varum)\b/i,
    "ta",
  ],
  [
    /\b(kitne|paise|lagenge|hoga|nahi|kab|karega|chaahiye|chahiye|thik|theek)\b/i,
    "hinglish",
  ],
];

function localDetectLanguage(text: string): string | null {
  for (const [rx, code] of SCRIPT_RANGES) {
    if (rx.test(text)) return code;
  }
  for (const [rx, code] of ROMAN_MARKERS) {
    if (rx.test(text)) return code;
  }
  return null;
}

function localFallback(text: string): ClientLanguage {
  const code = localDetectLanguage(text);
  if (!code) {
    console.warn("[translate] local fallback: no language detected; assuming English");
    return {
      language: "xx",
      languageLabel: labelFor("xx"),
      english: text,
      translated: false,
    };
  }
  console.warn(
    `[translate] local fallback detected: ${code} (translation unavailable online; passing original text to LLM)`
  );
  return {
    language: code,
    languageLabel: labelFor(code),
    // No translation without Gemini. The LLM reads the original language, and
    // translateForSpeech will reuse the code for the voice track.
    english: text,
    translated: true,
  };
}

function cacheGet(map: Map<string, any>, key: string) {
  const hit = map.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;
  if (hit) map.delete(key);
  return null;
}

/**
 * Detect the language of a customer utterance and translate it to English in
 * a single Gemini call. English / Hinglish-derived English text passes through.
 * Never throws — falls back to an English pass-through result.
 */
export async function detectAndTranslateToEnglish(
  text: string
): Promise<ClientLanguage> {
  const passThrough = (): ClientLanguage => ({
    language: "xx",
    languageLabel: labelFor("xx"),
    english: text,
    translated: false,
  });

  if (!translateEnabled() || !text || !text.trim()) return passThrough();

  const cacheKey = text.trim().toLowerCase();
  const cached = cacheGet(qCache, cacheKey);
  if (cached) return cached;

  const raw = await geminiAsk(
    `You are a call-center multilingual router. The customer utterance below may be Hindi, Hinglish (Roman script code-mixed), or another Indian/regional language written in any script.\n\n` +
      `1. On the FIRST line output exactly "LANG: " followed by one ISO code only (en, hi, bn, ta, te, mr, gu, kn, ml, pa, ur) or "hinglish" if it is Romanized Hindi code-mixed with English.\n` +
      `2. On the SECOND line output exactly "TRANSLATION: " followed by the English translation. If it is already English, repeat it unchanged.\n\n` +
      `CUSTOMER SAID: ${text}`
  );

  const failOrPassthrough = (): ClientLanguage => {
    console.warn("[translate] parse failed; trying local script/script-marker fallback");
    return localFallback(text);
  };
  if (!raw) {
    console.warn("[translate] Gemini unavailable; trying local fallback detection");
    return localFallback(text);
  }

  const langMatch = raw.match(/LANG:\s*([A-Za-z]+)/i);
  const trMatch = raw.match(/TRANSLATION:\s*([\s\S]+)/i);
  if (!trMatch) return failOrPassthrough();

  const code = (langMatch?.[1] ?? "en").toLowerCase();
  const english = trMatch[1].trim() || text;
  const isEnglish = code === "en";

  const result: ClientLanguage = {
    language: isEnglish ? "en" : code,
    languageLabel: labelFor(code),
    english,
    translated: !isEnglish,
  };
  qCache.set(cacheKey, { ...result, at: Date.now() });
  return result;
}

/**
 * Translate an English answer into the client's spoken language for TTS.
 * Skips the API entirely for English, unknown or disabled modes.
 * Never throws — falls back to the English text.
 */
export async function translateForSpeech(
  englishText: string,
  language: string
): Promise<string> {
  if (!englishText || !language || language === "en" || language.startsWith("en-")) {
    return englishText;
  }
  if (!translateEnabled()) return englishText;
  if (language === "xx") return englishText; // unknown → safest to speak English

  const cacheKey = `${language}::${englishText.trim().toLowerCase()}`;
  const cached = cacheGet(speechCache, cacheKey);
  if (cached) return cached.value;

  const label = labelFor(language);
  const raw = await geminiAsk(
    `Translate the following call-center agent message into ${label}.\n` +
      `Keep it natural, spoken and polite (Indian context allowed — e.g. use "Sir/Ma'am" equivalents naturally). Keep amounts, numbers and product terms like "card" or "SMS" recognizable.\n` +
      `Output ONLY the ${label} translation, nothing else.\n\n` +
      `ENGLISH MESSAGE: ${englishText}`
  );

  const value = raw ? raw.trim() : englishText;
  if (!raw) console.warn("[translate] answer translation failed; speaking English fallback");
  speechCache.set(cacheKey, { value, at: Date.now() });
  return value;
}
