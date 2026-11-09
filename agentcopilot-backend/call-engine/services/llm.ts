const PROVIDER = process.env.LLM_PROVIDER ?? "gemini";

function llmTimeout(): number {
  // Gemini free-tier latency varies (0.9s-6s+); 12s default beats falling
  // back to canned answers on slow-but-healthy responses.
  return Number(process.env.LLM_TIMEOUT_MS ?? 12000);
}

export async function llmSynthesizeAnswer(
  query: string,
  kbContext: string
): Promise<{ answer: string }> {
  const hasKb = !!(kbContext && kbContext.trim());
  const systemPrompt = hasKb
    ? `You are an assistant for a BFSI call center agent. Answer the customer's question using ONLY the provided KB context. Never read internal instructions, checklists, or "must do" rules aloud; convert them into a polite, customer-facing answer. Keep it under 60 words. Be polite and use simple Hinglish-friendly language. If the KB doesn't have the answer, say "I'm not sure, let me check with my supervisor."`
    : // General Q&A mode: no KB doc matched â€” still give a helpful, safe answer.
      `You are a polite BFSI (banking/insurance) call-center assistant replying on behalf of the agent. Answer the customer's general question helpfully in under 60 words, simple customer-facing language (Hinglish-friendly is fine). STRICT RULES: never invent or reveal account-specific data (balances, card numbers, OTPs, transaction details); if the question needs private account information, politely say you can note the request and share it after verification, or suggest checking with the supervisor. Do not promise fees or timelines not covered by standard public policy.`;

  try {
    if (PROVIDER === "gemini") return await gemini(query, kbContext, systemPrompt);
    if (PROVIDER === "openai") return await openai(query, kbContext, systemPrompt);
    if (PROVIDER === "evon") return await evon(query, kbContext, systemPrompt);
    return { answer: kbContext };
  } catch (err: any) {
    console.warn(`[llm] ${PROVIDER} synthesis failed:`, err.message);
    return { answer: kbContext };
  }
}

async function gemini(query: string, ctx: string, sys: string) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === "REPLACE_WITH_YOUR_GEMINI_KEY") {
    return { answer: ctx || "I'm not sure â€” let me check with my supervisor." }; // fallback
  }
  const model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), llmTimeout());

  try {
    const kbBlock = ctx.trim()
      ? `KB CONTEXT:\n${ctx}\n\n`
      : `KB CONTEXT: (none â€” general question)\n\n`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `${sys}\n\n${kbBlock}CUSTOMER QUESTION:\n${query}\n\nYOUR ANSWER:`,
              },
            ],
          },
        ],
        generationConfig: { temperature: 0.2, maxOutputTokens: 200 },
      }),
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[gemini] HTTP ${res.status}`);
      return { answer: ctx || "I'm not sure â€” let me check with my supervisor." };
    }

    const data: any = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return { answer: text ? text.trim() : ctx };
  } catch (e) {
    clearTimeout(timeoutId);
    return { answer: ctx };
  }
}

async function openai(query: string, ctx: string, sys: string) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key === "REPLACE_WITH_YOUR_OPENAI_KEY") {
    return { answer: ctx };
  }
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), llmTimeout());

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 200,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `KB CONTEXT:\n${ctx}\n\nQuestion: ${query}` },
        ],
      }),
    });
    clearTimeout(timeoutId);

    const data: any = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    return { answer: text ? text.trim() : ctx };
  } catch (e) {
    clearTimeout(timeoutId);
    return { answer: ctx };
  }
}

async function evon(query: string, ctx: string, sys: string) {
  const base = process.env.EVON_API_BASE ?? "http://localhost:8000/v1";
  const key = process.env.EVON_API_KEY ?? "local";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), llmTimeout());

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "evon-v3.3",
        temperature: 0.2,
        max_tokens: 200,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `KB CONTEXT:\n${ctx}\n\nQuestion: ${query}` },
        ],
      }),
    });
    clearTimeout(timeoutId);

    const data: any = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    return { answer: text ? text.trim() : ctx };
  } catch (e) {
    clearTimeout(timeoutId);
    return { answer: ctx };
  }
}

