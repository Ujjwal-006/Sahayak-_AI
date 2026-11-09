"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.llmSynthesizeAnswer = llmSynthesizeAnswer;
const PROVIDER = process.env.LLM_PROVIDER ?? "gemini";
async function llmSynthesizeAnswer(query, kbContext) {
    const systemPrompt = `You are an assistant for a BFSI call center agent. Answer the customer's question using ONLY the provided KB context. Never read internal instructions, checklists, or "must do" rules aloud; convert them into a polite, customer-facing answer. Keep it under 60 words. Be polite and use simple Hinglish-friendly language. If the KB doesn't have the answer, say "I'm not sure, let me check with my supervisor."`;
    try {
        if (PROVIDER === "gemini")
            return await gemini(query, kbContext, systemPrompt);
        if (PROVIDER === "openai")
            return await openai(query, kbContext, systemPrompt);
        if (PROVIDER === "evon")
            return await evon(query, kbContext, systemPrompt);
        return { answer: kbContext };
    }
    catch (err) {
        console.warn(`[llm] ${PROVIDER} synthesis failed:`, err.message);
        return { answer: kbContext };
    }
}
async function gemini(query, ctx, sys) {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key === "REPLACE_WITH_YOUR_GEMINI_KEY") {
        return { answer: ctx }; // fallback: return raw KB doc
    }
    const model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            {
                                text: `${sys}\n\nKB CONTEXT:\n${ctx}\n\nCUSTOMER QUESTION:\n${query}\n\nYOUR ANSWER:`,
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
            return { answer: ctx };
        }
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        return { answer: text ? text.trim() : ctx };
    }
    catch (e) {
        clearTimeout(timeoutId);
        return { answer: ctx };
    }
}
async function openai(query, ctx, sys) {
    const key = process.env.OPENAI_API_KEY;
    if (!key || key === "REPLACE_WITH_YOUR_OPENAI_KEY") {
        return { answer: ctx };
    }
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
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
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        return { answer: text ? text.trim() : ctx };
    }
    catch (e) {
        clearTimeout(timeoutId);
        return { answer: ctx };
    }
}
async function evon(query, ctx, sys) {
    const base = process.env.EVON_API_BASE ?? "http://localhost:8000/v1";
    const key = process.env.EVON_API_KEY ?? "local";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
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
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        return { answer: text ? text.trim() : ctx };
    }
    catch (e) {
        clearTimeout(timeoutId);
        return { answer: ctx };
    }
}
