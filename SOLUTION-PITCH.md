# AgentCopilot — Solution Pitch

**Gnani AI Great Indian AI Internship Challenge · Phase 1 + Phase 5 Submission**

AgentCopilot is a real-time call-center copilot: it listens live through Gnani Prisma streaming ASR, tracks statutory compliance automatically, surfaces grounded BFSI answers in under a second, speaks them in the relevant Indian language via Gnani Timbre TTS, and scores the call the moment it ends — streaming QA metrics, CRM prefill, and live dashboards over Socket.IO.

## The Problem

BFSI contact centers still run QA as retrospective sampling: a few calls audited days later, disclosure failures caught too late, agents unsupported and blind mid-call, knowledge locked in articles they cannot reach during live conversations, and Hinglish / multilingual speech breaking keyword tools.

## The Solution — three engines in one call loop

1. **Live compliance state machine.** Five statutory rules — recording disclosure, identity & OTP verification, annual-fee disclosure, resolution TAT (3–5 days), and a no-guaranteed-returns safety guard — are evaluated continuously on the transcript with evidence, timestamps, PENDING→PASSED/FAILED states, and automatic escalation on critical failures.
2. **Grounded knowledge synthesis.** Sub-second BM25-lite retrieval over indexed BFSI KB articles (intent-boosted) feeds Gemini 2.0 Flash, which answers in under 60 words, Hinglish-friendly and grounded — never inventing account data, with a safe general-Q&A fallback when no article matches.
3. **Voice-first delivery.** Replies are translated for speech and synthesized with Gnani Timbre in 10 Indian languages; agent-inserted replies are voiced back to the customer instantly.

**Pipeline:** mic/phone audio → Prisma ASR (Int16 16 kHz PCM) → parallel compliance + RAG + intent routing → Gemini synthesis → Timbre TTS → auto QA score, CRM summary, and dashboard events.

## What's Built & Working

- **Call Engine (:3003)** — Socket.IO orchestration powering transcription deltas, knowledge surfacing, compliance signals, and customer simulation; **dual mode** — Live mic streaming *and* Demo replay of real multi-speaker Kaggle call recordings via cached transcripts (zero API credits while demoing).
- **SaaS Backend (:4000)** — Express + Prisma 6 + JWT auth with role-based access (`AGENT`, `COMPLIANCE_OFFICER`), org-scoped QA records, audit logging, and dashboard analytics (totals, daily trends, agent leaderboard).
- **Three web terminals** — Auth Terminal, Agent Cockpit (live transcript, checklist, knowledge cards, talk:listen meter), Supervisor Dashboard (real-time `qa-call-scored` stream, 10-call compliance histogram, searchable audit dossier with overrides).
- **Speech analytics** — Talk:Listen ratio, dead-air tracking (>3 s pauses), automated CRM prefill and disposition.

## Proof of Quality

One command — `npm run test` — runs a 15-assertion end-to-end suite: health check, both logins, rejected bad credentials, seeded QA/dashboard data, the full socket pipeline (start → transcript → knowledge → TTS audio → summary → QA score), database persistence, and a real-LLM general-Q&A fallback. ~5,700 lines of production TypeScript across engine, backend, and frontends.

## Try It in 60 Seconds

Run `START-AGENTCOPILOT.bat` → open `http://localhost:4000` → log in as `priya@demo-bfsi.com` (Agent Cockpit) or `compliance@demo-bfsi.com` (Supervisor) → start a demo call and watch the compliance checklist fill, knowledge surface live, and the QA score land on the supervisor dashboard.
