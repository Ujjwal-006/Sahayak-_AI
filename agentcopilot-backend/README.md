# AgentCopilot Backend (Phase 1 + Phase 5)

### Gnani AI Great Indian AI Internship Challenge Submission

An intelligent, real-time call center copilot backend powering real-time dual-acoustic telemetry, automated BFSI compliance scoring, RAG knowledge synthesis, and speech synthesis.

---

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

---

## 1. Quick Start

### Prerequisites

- Node.js 20+ (Node v24 supported) or Bun 1.3+
- Windows, macOS, or Linux

### Installation

```bash
# 1. Install dependencies for SaaS Backend
cd saas-backend
npm install
npm run db:push
npm run db:seed

# 2. Install dependencies for Call Engine
cd ../call-engine
npm install

# 3. Pre-transcribe Kaggle samples for Demo Mode (run once)
npm run transcribe-samples
```

---

## 2. Running the Services

### Start SaaS Backend (Port 4000)

```bash
cd saas-backend
npm start
```

_Health endpoint:_ `http://localhost:4000/healthz`  
_Frontend web terminal:_ `http://localhost:4000/` or `http://localhost:4000/cockpit`

### Start Call Engine (Port 3003)

```bash
cd call-engine
npm start
```

_Socket.IO listening on:_ `http://localhost:3003`

### Run Automated End-to-End Test Suite

```bash
npm run test
```

---

## 3. Demo Credentials

| Role                           | Email                      | Password      | Destination   |
| ------------------------------ | -------------------------- | ------------- | ------------- |
| **Agent (Priya)**              | `priya@demo-bfsi.com`      | `password123` | `/cockpit`    |
| **Compliance Officer (Cyril)** | `compliance@demo-bfsi.com` | `password123` | `/supervisor` |

---

## 4. Environment Variables (`call-engine/.env.local`)

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

> `.env.local` is loaded first and takes precedence over `.env`. The same
> `GNANI_API_KEY` authenticates both Prisma (STT) and Timbre (TTS) — requests
> use the `X-API-Key-ID` header against `https://api.vachana.ai`.

---

## 5. Key Capabilities

1. **Dual Mode Operation**:
   - **Demo Mode**: Real-time replay of multi-speaker Kaggle call recordings (`Sample - 01`, `02`, `03`) using pre-transcribed cached transcripts. No Gnani credits consumed during demonstrations.
   - **Live Mode**: Direct microphone streaming using Int16 16kHz PCM frames to Gnani Prisma streaming ASR.
2. **5-Rule Statutory Compliance State Machine**:
   - `RULE_DISCLOSE_RECORDING` — Call Recording Consent Disclosed
   - `RULE_IDENTITY_VERIFICATION` — Identity & OTP Verified
   - `RULE_FEE_DISCLOSURE` — Annual Fee Waiver Policy Stated
   - `RULE_RESOLUTION_TAT` — Card Replacement TAT (3-5 Days)
   - `RULE_NO_GUARANTEED_RETURNS` — Negative phrase rule (escalation safety)
3. **RAG Knowledge Retrieval + LLM Synthesis**:
   - Sub-second BM25/keyword retrieval on BFSI banking knowledge base articles.
   - Grounded natural synthesis via Gemini 2.0 Flash (< 60 words, Hinglish friendly).
4. **Speech Cadence Analytics**:
   - Dynamic Talk-to-Listen Ratio calculation.
   - Continuous Dead Air tracking (pauses > 3.0 seconds).
   - Automated post-call CRM prefill and disposition generation.
5. **Supervisor Dashboard Integration**:
   - Real-time Socket.IO ingestion (`qa-call-scored`).
   - Dynamic 10-call compliance histogram.
   - Audit dossier table with supervisor overrides and search filters.
