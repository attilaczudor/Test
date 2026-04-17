# AttiClaw

Personal AI model management and inference platform, built on [OpenClaw](https://github.com/openclaw/openclaw).

**Version:** 2026.2.21 | **Docs:** [docs.openclaw.ai](https://docs.openclaw.ai) | **Discord:** [discord.gg/qkhbAGHRBT](https://discord.gg/qkhbAGHRBT) | **License:** MIT

AttiClaw is your standalone web dashboard for browsing, downloading, and running AI models locally. It combines a React-based management UI with the full OpenClaw autonomous agency engine — giving you a council of local AI models, hybrid memory, 50+ skills, 37 channel extensions, real-time voice, and native apps across macOS, iOS and Android.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Quick Start](#quick-start)
- [Installation (Ubuntu)](#installation-ubuntu)
- [AttiClaw Web App](#atticlaw-web-app)
- [Storage Architecture](#storage-architecture)
- [Model Management](#model-management)
- [Upstream Feature Sources](#upstream-feature-sources)
- [OpenClaw Core](#openclaw-core)
- [Council System](#council-system)
- [Memory & RAG](#memory--rag)
- [Smart Router](#smart-router)
- [Inference Backends](#inference-backends)
- [Skills & ClawHub](#skills--clawhub)
- [Extensions](#extensions)
- [Voice & Media](#voice--media)
- [Personality & Identity](#personality--identity)
- [Security](#security)
- [Database Backends](#database-backends)
- [Deployment](#deployment)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Testing](#testing)
- [CLI Reference](#cli-reference)
- [Contributing](#contributing)
- [License](#license)

---

## Architecture Overview

```
                            ATTICLAW
                       ┌──────────────────┐
                       │   AttiClaw UI    │  React + Vite  port 5180
                       │  Dashboard · Chat │  Tailwind · ShadCN/UI
                       │  Models · Skills  │  Zustand · i18n (EN/ZH/JA)
                       └────────┬─────────┘
                                │  WebSocket  ws://3100
                      ┌─────────┴──────────┐
                      │                    │
             ┌────────┴───────┐   ┌────────┴────────┐
             │  OpenClaw Core  │   │    Storage      │
             │  Gateway :3100  │   │  SMB (permanent)│
             │  Agent Loop     │   │  NVMe (runtime) │
             │  Council (3-tier│   └─────────────────┘
             │  Memory / RAG   │
             │  Skills · RBAC  │
             │  Sandbox · Voice│
             └────────┬────────┘
                      │
        ┌─────────────┼──────────────┐
        │             │              │
  ┌─────┴────┐  ┌─────┴────┐  ┌─────┴────┐
  │  Qdrant  │  │  Neo4j   │  │ MariaDB  │
  │ (vectors)│  │  (graph) │  │  (SQL)   │
  └──────────┘  └──────────┘  └──────────┘
        │             │              │
        └─────────────┼──────────────┘
                      │
        ┌─────────────┼──────────────────┐
        │             │                  │
  ┌─────┴────┐  ┌─────┴────┐  ┌─────────┴──────┐
  │  Ollama  │  │llama.cpp │  │ vLLM / LM Studio│
  │  local   │  │  GGUF    │  │   transformers  │
  └──────────┘  └──────────┘  └────────────────┘
```

---

## Quick Start

```bash
git clone --recurse-submodules https://github.com/attilaczudor/Test atticlaw
cd atticlaw
cp .env.example .env          # fill in tokens as needed
pnpm install
pnpm openclaw init            # interactive setup wizard
pnpm dev                      # gateway :3100 + AttiClaw UI :5180
```

Requires **Node.js ≥ 22.12** and **pnpm ≥ 10.23**.

---

## Installation (Ubuntu)

One-command installer for Ubuntu 22.04 / 24.04:

```bash
curl -fsSL https://raw.githubusercontent.com/attilaczudor/Test/main/install-ubuntu.sh | bash
```

What it does:
- Installs system dependencies, Node.js, pnpm
- Initialises all git submodules
- Sets up Ollama and pulls a default model
- Configures systemd services for gateway + AttiClaw
- Optionally configures SMB mounts for permanent model storage

Manual options:

```bash
./install-ubuntu.sh --no-ollama      # skip Ollama install
./install-ubuntu.sh --port 8080      # custom UI port
./install-ubuntu.sh --smb //nas/ai   # pre-configure SMB share
```

---

## AttiClaw Web App

```
AttiClaw/
├── src/
│   ├── pages/
│   │   ├── Dashboard/   — system overview, storage stats, running models
│   │   ├── Chat/        — conversation UI, connects to OpenClaw via ws://3100
│   │   ├── Models/      — HuggingFace browse, download, approval workflow
│   │   ├── Skills/      — repository sources, labels, URL import, skill cards
│   │   └── Settings/    — theme, language, SMB config, NVMe selector
│   ├── stores/          — Zustand (models, repos, sessions, settings)
│   ├── components/      — ShadCN/UI primitives + layout + UpdateSidebar
│   └── i18n/            — EN, ZH-CN, JA translations
└── vite.config.ts
```

**Stack:** React 19 · Vite · TypeScript · Tailwind CSS · ShadCN/UI · Zustand · react-i18next · Sonner

**Dev:**

```bash
cd AttiClaw
pnpm dev          # :5180
pnpm build
pnpm preview
```

---

## Storage Architecture

Two-tier storage keeps models safe while maximising inference speed:

```
┌─────────────────────────────────────────────────────────┐
│                     SMB Share (NAS)                     │
│              Permanent · All formats stored             │
│   GGUF · SafeTensors · ONNX · AWQ · GPTQ · BitsAndBytes │
└───────────────────────────┬─────────────────────────────┘
                            │  copy on demand
┌───────────────────────────┴─────────────────────────────┐
│                  Local NVMe (runtime)                   │
│         Active models only · Cleared on shutdown        │
│              Fast I/O for inference engines             │
└─────────────────────────────────────────────────────────┘
```

Configure in `openclaw.json` or via the Settings page in AttiClaw.

---

## Model Management

AttiClaw integrates directly with HuggingFace Hub:

| Feature | Detail |
|---------|--------|
| Browse & search | Filter by task, architecture, size, format |
| Smart recommendations | Based on available VRAM / RAM |
| One-click download | SMB → NVMe pipeline with progress |
| Approval workflow | Council director reviews large downloads |
| Format routing | Auto-selects the right inference backend |
| Update tracking | Detects newer model versions upstream |

**Format → Runtime mapping:**

| Format | Backend |
|--------|---------|
| GGUF | llama.cpp / Ollama |
| SafeTensors | vLLM / transformers / TGI |
| ONNX | ONNX Runtime |
| AWQ / GPTQ | vLLM (quantised GPU) |
| BitsAndBytes | transformers (NF4 / INT8) |

---

## Upstream Feature Sources

Three upstream repositories are tracked as git submodules under `repositories/`. Run `./setup-repos.sh --update` to pull the latest from all upstreams.

| Submodule | Upstream | What it brings |
|-----------|----------|----------------|
| `repositories/clawx` | [ValueCell-ai/ClawX](https://github.com/ValueCell-ai/ClawX) | Electron desktop UI, React + Zustand |
| `repositories/ironclaw` | [nearai/ironclaw](https://github.com/nearai/ironclaw) | Distributed orchestration, Near AI infra |
| `repositories/llama.cpp` | [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) | GGUF inference engine |

```bash
./setup-repos.sh              # init all + set upstream remotes
./setup-repos.sh --update     # fetch latest from all upstreams
./setup-repos.sh --status     # show divergence status
```

---

## OpenClaw Core

The engine that powers everything under `src/` (88+ modules):

| Capability | Detail |
|------------|--------|
| Agentic reasoning | Multi-turn loops, tool use, self-evaluation, max 100 turns |
| 3-tier council | Hierarchical LLM ensemble — Director → Branches → Specialists |
| Hybrid memory | Qdrant (vectors) + Neo4j (graph) + BM25 (keyword) |
| 50+ MCP skills | Productivity, dev, communication, media, AI/ML, system |
| 37 channel extensions | Discord, Slack, Telegram, Signal, iMessage, Matrix, and more |
| Real-time voice | Full-duplex VAD, barge-in, streaming TTS/STT |
| RBAC | 17+ permission types, path-level restrictions |
| Sandbox | Wasm / Docker / nsjail execution isolation |
| Smart Router | Local-first inference with council-gated cloud escalation |
| Native apps | macOS · iOS (WatchKit) · Android |
| LoRA fine-tuning | Continuous learning from interaction history |
| Plugin runtime | Hot-loadable plugins with lifecycle management |

---

## Council System

The council is a 3-tier hierarchy of local AI models that collaborate to answer complex queries. All reasoning stays on-device unless you explicitly approve cloud escalation.

### Tier Structure

```
╔══════════════════════════════════════════════════════════════════════╗
║                        TIER 1 — DIRECTOR                           ║
║                                                                      ║
║   ┌──────────────────────────────────────────────────────────────┐  ║
║   │  Model: Dolphin Mixtral 8×7B (47B MoE, uncensored)          │  ║
║   │  Role:  Decomposes the prompt · Assigns branches             │  ║
║   │         Synthesises final answer · Gates cloud escalation    │  ║
║   └──────────────────────────────────────────────────────────────┘  ║
╚══════════════════╤═══════════════════════╤═══════════════════════════╝
                   │                       │
       ┌───────────┘                       └───────────┐
       │                                               │
╔══════╧══════════════════════╗   ╔═════════════════════╧══════════════╗
║   TIER 2 — LOGICAL BRANCH   ║   ║   TIER 2 — CREATIVE BRANCH        ║
║                             ║   ║                                    ║
║  Coordinator:               ║   ║  Coordinator:                      ║
║  Nous Hermes 34B            ║   ║  Llama-2 70B                       ║
║                             ║   ║                                    ║
║  Dispatches to specialists  ║   ║  Dispatches to specialists         ║
║  Consolidates their output  ║   ║  Consolidates their output         ║
╚══════╤══════════════════════╝   ╚═════════╤══════════════════════════╝
       │                                    │
  ┌────┴─────────────┐              ┌───────┴──────────────┐
  │                  │              │                      │
╔═╧══════════╗ ╔═════╧══════╗  ╔════╧═══════╗  ╔══════════╧═══╗
║  TIER 3    ║ ║  TIER 3    ║  ║  TIER 3    ║  ║  TIER 3      ║
║ Specialist ║ ║ Specialist ║  ║ Specialist ║  ║  Specialist  ║
║            ║ ║            ║  ║            ║  ║              ║
║ Codebooga  ║ ║  Reviewer  ║  ║  Writing   ║  ║  Research    ║
║   34B      ║ ║   7B       ║  ║  Expert    ║  ║  Expert      ║
║            ║ ║            ║  ║  13B       ║  ║  13B         ║
╚════════════╝ ╚════════════╝  ╚════════════╝  ╚══════════════╝

  ← run in parallel →                ← run in parallel →

                         ┌──────────────────┐
                         │  CLOUD ESCALATION │  (requires user approval)
                         │  GPT-4 / Claude   │  only when local confidence
                         │  / Gemini Ultra   │  falls below threshold
                         └──────────────────┘
```

### Tier Reference

| Tier | Role | Model size | Count | Function |
|------|------|-----------|-------|----------|
| T1 — Director | Orchestrator | 30–70B | 1 | Decomposes prompt, assigns branches, synthesises final answer, gates cloud escalation |
| T2 — Branch Coordinators | Mid-level reasoning | 10–34B | 2–5 | Receive sub-tasks, dispatch to specialists, consolidate results |
| T3 — Specialists | Focused experts | 0.5–7B | 1–10 per coordinator | Single-domain answers, run in parallel for speed |

### Deliberation Flow

```
User prompt
    │
    ▼
┌───────────────┐
│ T1 Director   │ ── decomposes into sub-tasks
└───────┬───────┘
        │
   ┌────┴─────┐
   ▼          ▼
┌──────┐  ┌──────┐   ← T2 Branch Coordinators (parallel)
│ B-1  │  │ B-2  │
└──┬───┘  └──┬───┘
   │          │
 ┌─┴─┐      ┌─┴─┐
 S S S      S S S     ← T3 Specialists (parallel within each branch)
   │          │
   ▼          ▼
┌──────┐  ┌──────┐   ← branch consolidation
│ B-1  │  │ B-2  │
└──────┘  └──────┘
        │
        ▼
┌───────────────┐
│ T1 Director   │ ── synthesises final answer
└───────┬───────┘
        │
        ├─ confidence ≥ threshold → deliver answer
        │
        └─ confidence < threshold → propose cloud escalation
                                    (user approves / rejects)
```

### Persistent Member Memory

Each council member retains memory across model swaps:

- Isolated Qdrant vector collection per member
- Neo4j graph tags for interaction patterns
- LoRA adapter trained on member-specific history
- Per-member RAG namespace
- Metrics: query count · avg response time (EWMA) · avg confidence · error rate

### Configuration

```jsonc
// openclaw.json — council section
{
  "council": {
    "preset": "OPENCLAW_COUNCIL",
    "consensusThreshold": 0.75,
    "maxDeliberationRounds": 3,
    "timeoutMs": 300000,
    "requireCloudApproval": true
  }
}
```

---

## Memory & RAG

```
                     HYBRID MEMORY
          ┌──────────────────────────────────┐
          │                                  │
  ┌───────┴──────┐  ┌──────────┐  ┌─────────┴─────┐
  │    Qdrant    │  │  Neo4j   │  │    BM25 FTS   │
  │  dense vec   │  │  graph   │  │  keyword idx  │
  │  (semantic)  │  │ (entity  │  │  (SQLite-vec) │
  │              │  │  rels)   │  │               │
  └──────────────┘  └──────────┘  └───────────────┘
          │              │                │
          └──────────────┴────────────────┘
                         │
                  hybrid re-ranker
                  (RRF + BM25 score)
                         │
                  top-k results → context window
```

- **Qdrant** — per-agent vector collections, OpenAI / Gemini / Voyage / local embeddings
- **Neo4j** — entity relationships, cross-agent knowledge linking
- **BM25 FTS** — SQLite-vec for fast keyword retrieval with no extra service
- **Embedding cache** — deduplication table prevents re-embedding unchanged content
- **LRU index cache** — bounded cache (max 100 entries) prevents memory growth

---

## Smart Router

```
Incoming request
       │
       ▼
┌─────────────────┐
│ Local available? │──No──► queue / notify user
└────────┬────────┘
         │ Yes
         ▼
┌─────────────────┐
│ Confidence      │
│ estimation      │
└────────┬────────┘
         │
    ≥ threshold           < threshold
         │                     │
         ▼                     ▼
  ┌─────────────┐     ┌──────────────────┐
  │ Local model │     │ Council Director │
  │  answers    │     │ recommends cloud │
  └─────────────┘     └────────┬─────────┘
                               │
                      user approves?
                       Yes        No
                        │          │
                  ┌─────┴──┐  ┌────┴───┐
                  │ Cloud  │  │ Local  │
                  │ model  │  │ best   │
                  │        │  │ effort │
                  └────────┘  └────────┘
```

Local models are always tried first. Cloud costs are shown as estimates before approval.

---

## Inference Backends

| Backend | Formats | Best for |
|---------|---------|----------|
| **Ollama** | GGUF | Simple local setup, CPU + GPU |
| **llama.cpp** | GGUF | Maximum control, custom quantisation |
| **vLLM** | SafeTensors, AWQ, GPTQ | High-throughput GPU serving |
| **LM Studio** | GGUF, SafeTensors | Desktop GUI management |
| **transformers** | SafeTensors, BitsAndBytes | Research, fine-tuning |
| **TGI** | SafeTensors | Production-grade Hugging Face serving |
| **ONNX Runtime** | ONNX | CPU-optimised edge inference |

Backend discovery is automatic — OpenClaw scans for running services on startup.

---

## Skills & ClawHub

**53 bundled MCP skills** across 6 categories:

| Category | Examples |
|----------|---------|
| Productivity | Calendar, Tasks, Notes, Email, Browser |
| Development | Code execution, Git, Docker, terminal |
| Communication | Send messages via any channel extension |
| Media | Image generation, OCR, audio processing |
| AI/ML | Model eval, embedding, dataset tools |
| System | File ops, process management, cron |

**ClawHub** is the skill marketplace — browse, install, and verify community skills. Every skill is signature-verified and optionally scanned via VirusTotal before loading.

---

## Extensions

37 channel extensions ship as npm workspace packages under `extensions/`:

| Tier | Channels |
|------|---------|
| Messaging | Discord · Slack · Telegram · Signal · iMessage · WhatsApp · Matrix |
| Business | Mattermost · Teams · Lark · Zalo |
| Social | Twitter/X · Mastodon · Bluesky · Reddit |
| Voice | Twilio Voice · SIP · VoIP |
| Webhook | Generic HTTP · REST · GraphQL |
| IoT | MQTT · Home Assistant |

---

## Voice & Media

**STT (Speech-to-Text):**
- Whisper.cpp — CPU/GPU, quantised GGUF models
- Full-duplex with voice activity detection (VAD)
- Barge-in support (interrupt mid-response)

**TTS (Text-to-Speech):**
- Piper — fast CPU inference, 40+ voices
- NVIDIA NeMo Parakeet — GPU-accelerated, near-real-time
- Streaming output (tokens → audio as generated)

**Voice pipeline:**

```
Microphone → VAD → Whisper STT → Agent → Response text
                                              │
Speaker   ←─────── Piper/Parakeet TTS ←──────┘
```

---

## Personality & Identity

OpenClaw builds a persistent model of the user and each council member:

- **PersonalityDb** — SQL + Neo4j + Qdrant backends
- **UserKnowledgeGraph** — maps preferences, expertise, relationships
- **Interaction learning** — style, verbosity, creativity and rigor scores adapt over time
- **LoRA adapters** — per-member fine-tuning from conversation history
- **Clara** — default built-in personality with configurable traits

---

## Security

11-layer security model:

| Layer | Mechanism |
|-------|-----------|
| Transport | TLS 1.3, WSS, HSTS |
| Auth | Ed25519 CSRF tokens on every WebSocket message |
| Origins | Strict allowlist, CVE-2026-25253 mitigation |
| Rate limiting | Per-IP + per-token sliding window |
| Sandbox | Wasm / Docker / nsjail execution isolation |
| RBAC | 17+ permission types, path-level restrictions |
| Skills | Signature verification + optional VirusTotal scan |
| Secrets | detect-secrets in CI, no keys in repo |
| Hashing | SHA-256 throughout (SHA-1 fully removed) |
| Node.js | ≥ 22.12 (CVE-2025-59466 + CVE-2026-21636 patched) |
| Config | Schema validation, integer overflow guards |

---

## Database Backends

| Database | Role | Default port |
|----------|------|-------------|
| **Qdrant** | Vector store — embeddings, semantic search, per-agent collections | 6333 |
| **Neo4j** | Knowledge graph — entity relationships, council member tags | 7687 |
| **MariaDB** | Relational — repositories, KV store, personality data | 3306 |
| **SQLite** | Embedded — BM25 FTS index, embedding cache, local KV | file |

All four are optional — OpenClaw degrades gracefully when a backend is unavailable.

---

## Deployment

### Docker Compose (recommended)

```bash
docker compose up -d
```

Services and resource limits:

| Service | CPUs | RAM | Role |
|---------|------|-----|------|
| openclaw | 4 | 16 GB | Gateway + Agent + Web UI |
| qdrant | 2 | 4 GB | Vector store |
| neo4j | 2 | 8 GB | Knowledge graph |
| mariadb | 2 | 4 GB | Relational DB |

### Proxmox Layout (Threadripper example)

```
┌─────────────────────────────────────────────────────────────┐
│              Threadripper Host  (256 GB RAM)                │
│                                                             │
│  LXC 301 ─ openclaw          (8 cores / 24 GB)             │
│             Gateway :3100 · Agent · AttiClaw :5180          │
│                                                             │
│  VM  302 ─ council-director  (8 cores / 32 GB)             │
│             Dolphin Mixtral 8×7B                            │
│                                                             │
│  LXC 303 ─ branch-logical    (4 cores / 16 GB)             │
│  LXC 304 ─ branch-creative   (4 cores / 16 GB)             │
│  LXC 305 ─ specialist-code   (2 cores /  8 GB)             │
│  LXC 306 ─ specialist-review (2 cores /  8 GB)             │
│  LXC 307 ─ specialist-write  (2 cores /  8 GB)             │
│  LXC 308 ─ specialist-search (2 cores /  8 GB)             │
│                                                             │
│  VM  310 ─ qdrant            (4 cores /  8 GB)             │
│  VM  311 ─ neo4j             (4 cores /  8 GB)             │
│  VM  312 ─ mariadb           (2 cores /  4 GB)             │
│                                                             │
│  SMB NAS ─ model storage     (permanent · all formats)      │
│  NVMe    ─ runtime cache     (fast · active models only)    │
└─────────────────────────────────────────────────────────────┘
```

### Systemd (single machine)

```bash
sudo systemctl enable --now openclaw
sudo systemctl enable --now atticlaw
```

---

## Project Structure

```
atticlaw/
├── AttiClaw/               — standalone React web dashboard
│   ├── src/pages/          — Dashboard, Chat, Models, Skills, Settings
│   ├── src/stores/         — Zustand state (models, repos, sessions, settings)
│   └── src/components/     — ShadCN/UI + layout + UpdateSidebar
├── Swabble/                — Swift SDK (iOS / macOS integration)
├── src/                    — OpenClaw core engine (88+ modules)
│   ├── agent/              — reasoning loop, agentic state machine
│   ├── agents/             — auth, sandbox, tools coordination
│   ├── gateway/            — WebSocket server :3100, CSRF, rate limiting
│   ├── council/            — 3-tier council orchestration (4,200 LOC)
│   ├── memory/             — embeddings, LRU cache, batch runners
│   ├── rag/                — hybrid BM25 + vector + graph pipeline
│   ├── providers/          — OpenAI, Anthropic, Gemini, local backends
│   ├── router/             — smart router, confidence thresholding
│   ├── sandbox/            — Wasm / Docker / nsjail isolation
│   ├── rbac/               — 17+ permission types
│   ├── security/           — CSRF, rate limiting, origins validation
│   ├── skills/             — MCP skill loading and verification
│   ├── personality/        — PersonalityDb, UserKnowledgeGraph
│   ├── voice/              — VAD, STT, TTS, full-duplex pipeline
│   ├── channels/           — channel framework dispatcher
│   ├── lora/               — continuous LoRA fine-tuning
│   ├── infra/              — HuggingFace Hub + SMB/NVMe storage client
│   ├── tts/ stt/           — Piper, Whisper, NeMo Parakeet
│   └── config/             — schema validation, env loading
├── extensions/             — 37 channel plugins (Discord, Slack, Telegram…)
├── skills/                 — 50+ bundled MCP skills
├── apps/                   — macOS · iOS (WatchKit) · Android native apps
├── packages/               — clawdbot, moltbot workspace packages
├── ui/                     — web UI (Vite + Vitest)
├── docs/                   — Mintlify docs site (EN / ZH-CN / JA)
├── deploy/                 — Proxmox automation scripts
├── repositories/                  — 3 upstream feature submodules (clawx, ironclaw, llama.cpp)
├── test/                   — E2E + integration tests
├── docker-compose.yml
├── install-ubuntu.sh
├── openclaw.json           — generated by `pnpm openclaw init`
└── .env.example
```

---

## Configuration

Minimal `openclaw.json` (generated by `pnpm openclaw init`):

```jsonc
{
  "version": "2.0.0",
  "useCloudModels": false,
  "agent": {
    "defaultModel": "llama3.2:3b",
    "maxTurns": 100
  },
  "gateway": {
    "host": "127.0.0.1",
    "port": 3100,
    "allowedOrigins": ["http://localhost:3101", "http://localhost:5180"]
  },
  "council": {
    "preset": "OPENCLAW_COUNCIL",
    "consensusThreshold": 0.75,
    "maxDeliberationRounds": 3,
    "timeoutMs": 300000,
    "requireCloudApproval": true
  },
  "memory": {
    "backend": "hybrid",
    "maxNodes": 10000
  },
  "sandbox": {
    "enabled": true,
    "runtime": "wasm"
  },
  "discovery": {
    "enabled": true
  }
}
```

Full schema: `src/config/schema.ts`

---

## Testing

```bash
pnpm test                  # all tests
pnpm test:unit             # unit tests only
pnpm test:integration      # integration tests
pnpm test:e2e              # end-to-end tests
pnpm test:coverage         # coverage report
```

**1,375+ tests** across 4 Vitest configs. Coverage thresholds enforced in CI:

| Metric | Threshold |
|--------|-----------|
| Statements | 80% |
| Branches | 75% |
| Functions | 80% |
| Lines | 80% |

---

## CLI Reference

```bash
pnpm openclaw init          # interactive setup wizard
pnpm openclaw start         # start gateway + agent daemon
pnpm openclaw stop          # stop daemon
pnpm openclaw status        # show running services
pnpm openclaw council       # inspect council members + metrics
pnpm openclaw skills        # list installed skills
pnpm openclaw skills add    # install a skill from ClawHub
pnpm openclaw models        # list downloaded models
pnpm openclaw logs          # tail logs (gateway / agent / council)
pnpm openclaw upgrade       # pull upstream + rebuild
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [VISION.md](VISION.md) for guidelines and project direction.

To update all upstream submodules:

```bash
./setup-repos.sh --update
```

---

## License

MIT — see [LICENSE](LICENSE).

Upstream projects retain their own licences. See each `repositories/*/LICENSE` for details.
