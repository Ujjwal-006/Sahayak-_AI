# AgentCopilot — Real-Time BFSI Call-Center Copilot

**Gnani AI Great Indian AI Internship Challenge · Phase 1 + Phase 5 Submission**

AgentCopilot is a real-time call-center copilot: it listens live through Gnani Prisma streaming ASR, tracks statutory compliance automatically, surfaces grounded BFSI answers in under a second, speaks them in the relevant Indian language via Gnani Timbre TTS, and scores the call the moment it ends — streaming QA metrics, CRM prefill, and live dashboards over Socket.IO.

## The Problem

BFSI contact centers still run QA as retrospective sampling: a few calls audited days later, disclosure failures caught too late, agents unsupported and blind mid-call, knowledge locked in articles they cannot reach during live conversations, and Hinglish / multilingual speech breaking keyword tools.

## The Solution — three engines in one call loop

1. **Live compliance state machine.** Five statutory rules — recording disclosure, identity & OTP verification, annual-fee disclosure, resolution TAT (3–5 days), and a no-guaranteed-returns safety guard — are evaluated continuously on the transcript with evidence, timestamps, PENDING→PASSED/FAILED states, and automatic escalation on critical failures.
2. **Grounded knowledge synthesis.** Sub-second BM25-lite retrieval over indexed BFSI KB articles (intent-boosted) feeds Gemini 2.0 Flash, which answers in under 60 words, Hinglish-friendly and grounded — never inventing account data, with a safe general-Q&A fallback when no article matches.
3. **Voice-first delivery.** Replies are translated for speech and synthesized with Gnani Timbre in 10 Indian languages; agent-inserted replies are voiced back to the customer instantly.

**Pipeline:** mic/phone audio → Prisma ASR (Int16 16 kHz PCM) → parallel compliance + RAG + intent routing → Gemini synthesis → Timbre TTS → auto QA score, CRM summary, and dashboard events.

## Architecture Overview

```
                      +---------------------------------------+
                      |       Frontend Stitch Terminals       |
                      |  - Auth Terminal                      |
                      |  - Agent Cockpit                      |
                      |  - Supervisor Dashboard               |
                      +-------------------+-------------------+
                                          |
                        REST (/api/auth)  |  Socket.IO (:3003)
                        REST (/api/qa)    |  Audio Frames / Events
                                          |
                    +----------------------+----------------------+
                    |                                             |
                    v                                             v
        +-----------------------+                    +-------------------------+
        |   SaaS Backend :4000  |                    |    CallEngine :3003     |
        |  Express + SQLite     |                    |  Real-time Orchestration|
        |  Prisma 6 ORM         | <--- Persist Call  |  Compliance State Engine|
        |  JWT Authentication   |     (/api/ingest)  |  BFSI RAG Knowledge     |
        |  QA Audit Records     |                    |  Analytics (Talk:Listen)|
        +-----------------------+                    +------------+------------+
                                                                  |
                                      +-------------------------+-------------------------+
                                      |                         |                         |
                                      v                         v                         v
                            +-------------------+     +-------------------+     +-------------------+
                            |  Gnani Prisma     |     |  Gemini 2.0 Flash |     |  Gnani Timbre     |
                            |  Streaming ASR    |     |  Answer Synthesis |     |  TTS Voice Synth  |
                            +-------------------+     +-------------------+     +-------------------+
```

## Try It in 60 Seconds

Run **`START-AGENTCOPILOT.bat`** → open `http://localhost:4000` → log in as `priya@demo-bfsi.com` (Agent Cockpit) or `compliance@demo-bfsi.com` (Supervisor) → start a demo call and watch the compliance checklist fill, knowledge surface live, and the QA score land on the supervisor dashboard.

The launcher checks/kills ports 3003 and 4000, starts the SaaS Backend and Call Engine, and opens the browser at `http://localhost:4000/cockpit`.

## Manual Setup

### Prerequisites

- Node.js 20+ (Node v24 supported) or Bun 1.3+
- Windows, macOS, or Linux

### Installation

```bash
# 1. Install dependencies for SaaS Backend
cd agentcopilot-backend/saas-backend
npm install
npm run db:push
npm run db:seed

# 2. Install dependencies for Call Engine
cd ../call-engine
npm install

# 3. Pre-transcribe Kaggle samples for Demo Mode (run once)
npm run transcribe-samples
```

### Running the Services

```bash
# SaaS Backend (port 4000)
cd agentcopilot-backend/saas-backend
npm start

# Call Engine (port 3003)
cd agentcopilot-backend/call-engine
npm start
```

- SaaS Backend health: `http://localhost:4000/healthz`
- Frontend terminals: `http://localhost:4000/` (Auth) and `http://localhost:4000/cockpit`
- Socket.IO: `http://localhost:3003`

## Demo Credentials

| Role                           | Email                      | Password      | Destination   |
| ------------------------------ | -------------------------- | ------------- | ------------- |
| **Agent (Priya)**              | `priya@demo-bfsi.com`      | `password123` | `/cockpit`    |
| **Compliance Officer (Cyril)** | `compliance@demo-bfsi.com` | `password123` | `/supervisor` |

### How to Test

1. On the Cockpit screen, click **[PLAY DEMO CALL]** or **PLAY SAMPLE**
2. Or click **LIVE MIC** to speak live into your laptop microphone
3. Watch live transcript, VU meters, compliance checklist & KB suggestions
4. Click **INSERT INTO RESPONSE** or **USE REPLY** to dispatch the suggested reply
5. Click **SYNTHESIS** to hear the Hinglish voice reply
6. Click **END CALL** to view the laboratory QA audit report

## Key Capabilities

1. **Dual Mode Operation**
   - **Demo Mode**: Real-time replay of multi-speaker Kaggle call recordings (`Sample - 01`, `02`, `03`) using pre-transcribed cached transcripts — zero Gnani credits consumed while demoing.
   - **Live Mode**: Direct microphone streaming using Int16 16kHz PCM frames to Gnani Prisma streaming ASR.
2. **5-Rule Statutory Compliance State Machine**
   - `RULE_DISCLOSE_RECORDING` — Call Recording Consent Disclosed
   - `RULE_IDENTITY_VERIFICATION` — Identity & OTP Verified
   - `RULE_FEE_DISCLOSURE` — Annual Fee Waiver Policy Stated
   - `RULE_RESOLUTION_TAT` — Card Replacement TAT (3–5 Days)
   - `RULE_NO_GUARANTEED_RETURNS` — Negative phrase rule (escalation safety)
3. **RAG Knowledge Retrieval + LLM Synthesis**
   - Sub-second BM25/keyword retrieval on BFSI banking knowledge base articles
   - Grounded natural synthesis via Gemini 2.0 Flash (< 60 words, Hinglish friendly)
4. **Speech Cadence Analytics**
   - Dynamic Talk-to-Listen ratio calculation
   - Continuous dead-air tracking (pauses > 3.0 s)
   - Automated post-call CRM prefill and disposition generation
5. **Supervisor Dashboard Integration**
   - Real-time Socket.IO ingestion (`qa-call-scored`)
   - Dynamic 10-call compliance histogram
   - Audit dossier table with supervisor overrides and search filters

## Environment Variables (`agentcopilot-backend/call-engine/.env.local`)

```env
# Gnani AI Voice Platform — ONE key for STT (Prisma) + TTS (Timbre)
GNANI_API_KEY=REPLACE_WITH_YOUR_GNANI_KEY
GNANI_API_BASE=https://api.vachana.ai

# Speech-to-Text — Prisma v3.0
GNANI_ASR_MODEL=prisma-v3.0
GNANI_ASR_LANGUAGE=hi-IN
GNANI_ASR_FORMAT=transliterate
GNANI_ASR_BATCH_FORMAT=codemix
GNANI_ASR_SAMPLE_RATE=16000

# Text-to-Speech — Timbre v3.0
GNANI_TTS_MODEL=timbre-v3.0
GNANI_TTS_VOICE=Shivani
GNANI_TTS_LANGUAGE=auto
GNANI_TTS_SPEED=1.0

# Knowledge Synthesis LLM
GEMINI_API_KEY=REPLACE_WITH_YOUR_GEMINI_KEY
GEMINI_MODEL=gemini-2.0-flash
LLM_PROVIDER=gemini   # "gemini" | "openai" | "evon"

# Ports & Storage
CALL_ENGINE_PORT=3003
SAAS_BACKEND_PORT=4000
DATABASE_URL=file:./dev.db
DEMO_MODE=both
SAMPLES_DIR=./samples
```

> `.env.local` is loaded first and takes precedence over `.env`. The same `GNANI_API_KEY` authenticates both Prisma (STT) and Timbre (TTS) — requests use the `X-API-Key-ID` header against `https://api.vachana.ai`.

## Proof of Quality

One command — `npm run test` (from `agentcopilot-backend/`) — runs a 15-assertion end-to-end suite: health check, both logins, rejected bad credentials, seeded QA/dashboard data, the full socket pipeline (start → transcript → knowledge → TTS audio → summary → QA score), database persistence, and a real-LLM general-Q&A fallback.

~5,700 lines of production TypeScript across engine, backend, and frontends.

## Repo Structure

```
.
├── README.md                       # This file
├── SOLUTION-PITCH.md               # Solution pitch document
├── START-AGENTCOPILOT.bat          # One-click Windows launcher
└── agentcopilot-backend/
    ├── call-engine/                # Real-time orchestration engine :3003
    │   ├── index.ts                # Entry point / Socket.IO server
    │   ├── compliance.ts           # 5-rule compliance state machine
    │   ├── kb.ts                   # BM25-lite RAG knowledge base
    │   ├── analytics.ts            # Talk:Listen, dead-air analytics
    │   ├── session.ts / events.ts  # Session & event definitions
    │   ├── samples/                # Kaggle call recordings
    │   └── transcribe-samples.ts   # Demo transcript cache builder
    ├── saas-backend/               # SaaS backend :4000 (Express + Prisma 6)
    ├── frontend/                   # Auth Terminal, Agent Cockpit, Supervisor Dashboard
    ├── test-backend.ts             # 15-assertion end-to-end test suite
    └── README.md                   # Detailed backend documentation
```

## Documentation

- [`SOLUTION-PITCH.md`](./SOLUTION-PITCH.md) — problem, solution, and proof of quality
- [`agentcopilot-backend/README.md`](./agentcopilot-backend/README.md) — detailed backend documentation
