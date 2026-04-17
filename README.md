# AttiClaw

Personal AI model management and inference platform, built on [OpenClaw](https://github.com/openclaw/openclaw).

**Version:** 2026.2.21 | **Docs:** [docs.openclaw.ai](https://docs.openclaw.ai) | **Discord:** [discord.gg/qkhbAGHRBT](https://discord.gg/qkhbAGHRBT) | **License:** MIT

AttiClaw is your own standalone web dashboard for browsing, downloading, and running AI models locally. It pulls features from multiple upstream open-source projects (OpenClaw, ClawX, llama.cpp, IronClaw, ZeroClaw, and more) while maintaining a clean fork-based architecture.

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

## Architecture Overview

```
                        YOUR APP
                    ┌──────────────┐
                    │   AttiClaw   │  ← Standalone web dashboard
                    │  (React+Vite │     Port 5180
                    │   ShadCN/UI) │     Your own branding & features
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              v            v            v
     ┌────────────┐ ┌───────────┐ ┌──────────┐
     │  OpenClaw   │ │  Storage  │ │  Models  │
     │  Gateway    │ │ SMB+NVMe  │ │ HuggingFace│
     │  ws://3100  │ │ Client    │ │ Hub Client │
     └──────┬─────┘ └─────┬─────┘ └─────┬────┘
            │              │              │
     ┌──────┴──────┐  ┌───┴───┐   ┌──────┴──────┐
     │ Agent Loop  │  │  SMB  │   │ Download →  │
     │ Council     │  │  (all │   │ SMB (store) │
     │ Memory/RAG  │  │ files)│   │ NVMe (run)  │
     │ Skills      │  └───────┘   └─────────────┘
     └──────┬──────┘
            │
     ┌──────┴──────────────────────────────────┐
     │           Inference Backends              │
     │  Ollama │ llama.cpp │ vLLM │ LM Studio   │
     └─────────────────────────────────────────┘

     UPSTREAM FEATURE SOURCES (git submodules in repos/):
     ┌─────────────────────────────────────────┐
     │ clawx      │ ironclaw  │ llama.cpp      │
     │ nanobot    │ picoclaw  │ zeroclaw       │
     │ awesome-openclaw-usecases               │
     └─────────────────────────────────────────┘
```

**Key principles:**

- AttiClaw is YOUR app — independent from upstream projects
- OpenClaw is the core engine (upstream fork)
- All feature sources are git submodules with upstream remotes
- SMB = permanent storage for everything; NVMe = fast cache for running models only
- You choose which models to use; the system suggests better ones; you approve

## Quick Start

```bash
# Clone
git clone https://github.com/attilaczudor/Test.git atticlaw
cd atticlaw

# Initialize all upstream submodules
./setup-repos.sh

# Install and build OpenClaw core
pnpm install && pnpm build

# Install and start AttiClaw
cd AttiClaw && pnpm install && pnpm dev
# Open http://localhost:5180

# In another terminal — start OpenClaw backend
cd .. && pnpm start
```

## Installation (Ubuntu)

Full automated installer for Ubuntu 22.04 / 24.04:

```bash
sudo bash install-ubuntu.sh
```

The installer handles everything:

| Step             | What it does                             |
| ---------------- | ---------------------------------------- |
| 1. System deps   | build-essential, curl, git, python3, jq  |
| 2. Storage tools | cifs-utils (SMB), nvme-cli, mount points |
| 3. Node.js 22    | Via NodeSource                           |
| 4. pnpm          | Via corepack                             |
| 5. Clone repo    | Git clone + checkout                     |
| 6. Submodules    | All 8 upstream feature sources           |
| 7. OpenClaw core | Dependencies + TypeScript build          |
| 8. AttiClaw app  | Dependencies + Vite build                |
| 9. Ollama        | LLM inference backend                    |

Plus: systemd services (openclaw.service, atticlaw.service), SMB mount guidance.

```bash
# Options
sudo bash install-ubuntu.sh --headless     # Unattended, all defaults
sudo bash install-ubuntu.sh --dir ~/ai     # Custom install path
sudo bash install-ubuntu.sh --skip-ollama  # Skip Ollama
sudo bash install-ubuntu.sh --skip-smb     # Skip SMB tools
```

### Manual Install

```bash
# Prerequisites: Ubuntu, Node.js >= 22, pnpm
git clone https://github.com/attilaczudor/Test.git /opt/atticlaw
cd /opt/atticlaw

# Submodules
git submodule update --init --recursive
./setup-repos.sh

# OpenClaw core
pnpm install && pnpm build

# AttiClaw
cd AttiClaw && pnpm install && pnpm build

# LLM backend
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull llama3.2:3b
```

## AttiClaw Web App

AttiClaw is a standalone React web application — your personal AI dashboard.

### Technology Stack

| Technology        | Purpose                                        |
| ----------------- | ---------------------------------------------- |
| **React 19**      | UI framework                                   |
| **Vite**          | Build tool + dev server (port 5180)            |
| **TypeScript**    | Type safety                                    |
| **Tailwind CSS**  | Utility-first styling                          |
| **ShadCN/UI**     | Component library (12 components)              |
| **Zustand**       | State management with localStorage persistence (models, settings, repos stores) |
| **react-i18next** | Internationalization (EN, ZH, JA)              |
| **React Router**  | Client-side routing                            |
| **Sonner**        | Toast notifications                            |

### Pages

| Page          | Description                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------- |
| **Dashboard** | System overview — models stored, models running, SMB status, NVMe usage                         |
| **Chat**      | Conversation interface (connects to OpenClaw agent)                                             |
| **Models**    | HuggingFace browse, download, recommendations, approve workflow, storage config                 |
| **Settings**  | Theme, language, SMB config, NVMe drive selector                                                |
| **Skills**    | Browse and manage repository sources with labels, stars, and souls.directory integration        |

### ShadCN/UI Components

Button, Card, Badge, Tabs, Input, Select, Dialog, Progress, Separator, Switch, Tooltip, Label — all following the ShadCN convention with Radix UI primitives.

### Development

```bash
cd AttiClaw
pnpm install
pnpm dev          # Dev server on http://localhost:5180
pnpm build        # Production build to dist/
pnpm typecheck    # TypeScript checking
```

## Storage Architecture

Two-tier storage with clear separation of concerns:

```
┌─────────────────────────────────────────────┐
│              SMB Share (permanent)            │
│  //192.168.1.100/models                      │
│                                              │
│  models/          ← all downloaded models    │
│  datasets/        ← training data, samples   │
│  voice-samples/   ← voice cloning refs       │
│  configs/         ← model configs            │
│  files/           ← other files              │
└──────────────────────┬──────────────────────┘
                       │ Load (copy)
                       v
┌─────────────────────────────────────────────┐
│              NVMe Drive (runtime cache)      │
│  /mnt/nvme-models                            │
│                                              │
│  ONLY running models live here               │
│  Auto-evicts LRU when full                   │
│  Deleted on unload (stays on SMB)            │
└─────────────────────────────────────────────┘
```

| Storage   | Purpose                               | Persistence        | Access speed |
| --------- | ------------------------------------- | ------------------ | ------------ |
| **SMB**   | All files — models, datasets, configs | Permanent          | Network      |
| **NVMe**  | Running models only                   | Temporary cache    | Fast local   |
| **Cache** | Fallback when SMB disconnected        | Until SMB connects | Local disk   |

### Key behaviors

- Downloads always target SMB (permanent storage)
- Models copied to NVMe only when loaded for inference
- Unload removes NVMe copy — model stays safe on SMB
- Auto-evicts least-recently-used from NVMe when capacity is low
- Auto-migrates cached files to SMB when the share reconnects
- Non-model files (datasets, voice samples) never touch NVMe
- SMB credentials configurable in AttiClaw Settings UI

### SMB Configuration

Configure via AttiClaw Settings page or `/etc/fstab`:

```bash
# Credentials file
echo -e 'username=YOUR_USER\npassword=YOUR_PASS' > /root/.smb-credentials
chmod 600 /root/.smb-credentials

# /etc/fstab entry
//192.168.1.100/models  /mnt/smb-models  cifs  credentials=/root/.smb-credentials,uid=1000  0  0
```

## Model Management

### HuggingFace Hub Integration

Browse and download models from HuggingFace directly in AttiClaw:

| Feature               | Description                                                     |
| --------------------- | --------------------------------------------------------------- |
| **Search**            | Search HuggingFace by name, task, format                        |
| **All formats**       | GGUF, SafeTensors, PyTorch, ONNX, GPTQ, AWQ                     |
| **All tasks**         | Text generation, speech-to-speech, TTS, STT, vision, embeddings |
| **Runtime mapping**   | Auto-detects which backends can serve each format               |
| **Sharded models**    | Detects and handles multi-file sharded models                   |
| **Download progress** | Real-time progress with speed and ETA                           |

### Format → Runtime Compatibility

| Format          | Compatible Runtimes          |
| --------------- | ---------------------------- |
| **GGUF**        | Ollama, llama.cpp, LM Studio |
| **SafeTensors** | vLLM, transformers, TGI      |
| **PyTorch**     | transformers                 |
| **ONNX**        | ONNX Runtime                 |
| **GPTQ / AWQ**  | vLLM, transformers           |

### Model Recommendations

The system suggests models based on your hardware and needs. You approve or dismiss each suggestion.

| Category         | Recommended Models                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| **General Chat** | Qwen3-32B-GGUF (95), Llama-3.1-8B-GGUF (90), Llama-3.3-70B (96)                                    |
| **Code**         | Qwen2.5-Coder-32B (95), Qwen2.5-Coder-7B-GGUF (88)                                                 |
| **MoE**          | Kimi-K2.5 (94) — requires vLLM + multi-GPU                                                         |
| **Voice**        | personaplex-7b (92, speech-to-speech), whisper-large-v3-turbo (93, STT), fish-speech-1.5 (87, TTS) |
| **Multimodal**   | llama3-llava-next-8b (85, vision+text)                                                             |
| **Embeddings**   | bge-m3 (94, multilingual), nomic-embed-text-v1.5 (88, 8K context)                                  |

### Workflow

```
Browse HuggingFace → Select model → Download to SMB
                                          ↓
     System suggests better model → You approve/dismiss
                                          ↓
     Load to NVMe (fast cache) → Assign to backend → Inference
                                          ↓
     Stop model → Unload from NVMe → Stays safe on SMB
```

## Upstream Feature Sources

All upstream repos are git submodules with fork + upstream remotes:

| Submodule                         | Upstream                                                                                        | Description                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `repos/clawx`                     | [ValueCell-ai/ClawX](https://github.com/ValueCell-ai/ClawX)                                     | Electron desktop UI (React + Zustand + i18n)            |
| `repos/ironclaw`                  | [nearai/ironclaw](https://github.com/nearai/ironclaw)                                           | Near AI agent infrastructure, distributed orchestration |
| `repos/llama.cpp`                 | [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp)                                     | GGUF model inference engine                             |
| `repos/zeroclaw`                  | [zeroclaw-labs/zeroclaw](https://github.com/zeroclaw-labs/zeroclaw)                             | Zero-shot agent framework                               |
| `repos/nanobot`                   | [HKUDS/nanobot](https://github.com/HKUDS/nanobot)                                               | Lightweight AI agent (HKU Data Science)                 |
| `repos/picoclaw`                  | [sipeed/picoclaw](https://github.com/sipeed/picoclaw)                                           | Edge deployment on RISC-V hardware                      |
| `repos/artemis`                   | [Stanford-Trinity/ARTEMIS](https://github.com/Stanford-Trinity/ARTEMIS)                         | AI research framework (Stanford)                        |
| `repos/awesome-openclaw-usecases` | [anthropics/awesome-openclaw-usecases](https://github.com/anthropics/awesome-openclaw-usecases) | 29 curated use cases (3.8k stars)                       |

### Managing Upstream Repos

```bash
# Initialize all submodules + set upstream remotes
./setup-repos.sh

# Fetch latest from all upstreams
./setup-repos.sh --update

# Show status
./setup-repos.sh --status

# Merge upstream changes into a specific repo
cd repos/ironclaw && git fetch upstream && git merge upstream/main
```

All repos use the fork pattern: `attilaczudor/<name>` (fork) ← `<org>/<name>` (upstream).

## OpenClaw Core

The core engine (upstream fork of [openclaw/openclaw](https://github.com/openclaw/openclaw)):

- **Agentic reasoning** — Multi-turn loop with tool use, memory, shell execution
- **Local-first** — Ollama, vLLM, llama.cpp, LM Studio
- **Council-gated escalation** — Cloud only when local models lack confidence + user approval
- **Graph memory** — Neo4j-backed knowledge graph with importance scoring and decay
- **Hybrid RAG** — BM25 + vector similarity + graph traversal
- **LoRA fine-tuning** — Continuous learning from high-quality interactions
- **53 MCP skills** — Productivity, dev, communication, media, AI/ML, system
- **37 extensions** — Discord, Slack, Telegram, WhatsApp, Signal, Matrix, IRC, and more
- **Real-time voice** — Full-duplex with VAD and barge-in
- **Multi-platform** — Node.js, Electron, macOS, iOS, Android

## Council System

3-tier hierarchical council for complex reasoning:

| Tier   | Role       | Params | Count           | Description                                 |
| ------ | ---------- | ------ | --------------- | ------------------------------------------- |
| **T1** | Director   | 3-70B  | 1               | Decomposes, synthesizes, manages escalation |
| **T2** | Branch     | 2-20B  | 2-5             | Any expertise, dispatches to specialists    |
| **T3** | Specialist | 0.5-7B | Up to 10/branch | Small focused models, parallel answers      |

Every member has persistent memory (vector DB, graph, LoRA) across model swaps.

**Deliberation:** Prompt → Director decomposes → Branches dispatch → Specialists answer in parallel → Branches consolidate → Director synthesizes → Cloud escalation if needed (user approval required).

## Memory & RAG

- **Graph Memory** — Neo4j knowledge graph with node types (fact, task, contact, file, experience, summary), importance scoring (0-1), decay, auto-summarization
- **Vector Store** — Qdrant embeddings with cosine similarity, configurable dimensions
- **Hybrid RAG** — BM25 keyword + vector similarity + graph traversal, local embeddings

## Smart Router

Local-first with intelligent escalation:

```
Query → Local LLM → Confidence >= 0.6? → Return
                         ↓ NO
         Council Deliberation → Cloud needed?
                                    ↓ YES
                    User Approval → Cloud API → Return
```

Cost controls: per-request limit ($0.50), daily budget ($10), per-provider tracking.

## Inference Backends

| Backend          | URL             | Formats                | Description                               |
| ---------------- | --------------- | ---------------------- | ----------------------------------------- |
| **Ollama**       | localhost:11434 | GGUF                   | Full-featured, model pulling, GPU offload |
| **llama.cpp**    | localhost:8080  | GGUF                   | Direct GGUF serving                       |
| **vLLM**         | localhost:8000  | SafeTensors, GPTQ, AWQ | High-throughput, PagedAttention           |
| **LM Studio**    | localhost:1234  | GGUF                   | GUI-based, OpenAI-compatible              |
| **transformers** | —               | All                    | Python-based, universal                   |
| **TGI**          | —               | SafeTensors            | Text Generation Inference                 |
| **ONNX Runtime** | —               | ONNX                   | Optimized inference                       |

Autodiscovery probes all known ports on startup.

## Skills & ClawHub

53 bundled MCP skills across productivity, dev, communication, media, AI/ML, system, hardware, web, and home categories.

[ClawHub](https://clawhub.ai) marketplace with SHA-256 verification, VirusTotal scanning (mandatory after ClawHavoc incident — 341 malicious skills removed Feb 2026).

## Extensions

37 extensions: Discord, Slack, Telegram, WhatsApp, Signal, iMessage, Matrix, IRC, LINE, Nostr, Twitch, MS Teams, Google Chat, Feishu, Mattermost, Nextcloud Talk, Zalo, Tlon, voice-call, phone-control, copilot-proxy, diagnostics-otel, and more.

## Voice & Media

- **Real-time voice** — Full-duplex with VAD, barge-in, continuous loop
- **TTS** — Piper (CPU) / NVIDIA NeMo Parakeet (GPU)
- **STT** — Whisper.cpp (CPU) / NVIDIA NeMo Canary (GPU)
- **Vision** — LLaVA via Ollama
- **Voice models** — nvidia/personaplex-7b (speech-to-speech), fish-speech (TTS with cloning)

## Personality & Identity

Persistent personality system (PersonalityDb): AI name/style/traits, user profile tracking, interaction pattern learning, conversation summarization. Multi-backend storage (SQL + Neo4j + Qdrant).

## Security

| Layer             | Protection                                                       |
| ----------------- | ---------------------------------------------------------------- |
| **Sandbox**       | Wasm/Docker/nsjail with memory+CPU limits                        |
| **RBAC**          | 17+ permission types, path-level restrictions                    |
| **CSRF**          | Ed25519 signed tokens on WebSocket messages                      |
| **Origins**       | Strict allow-list (CVE-2026-25253 mitigation)                    |
| **Rate Limiting** | Per-IP sliding window                                            |
| **TLS**           | Optional HTTPS/WSS                                               |
| **Skills**        | Signature verification + VirusTotal scanning                     |
| **Downloads**     | SHA-256 hash verification                                        |
| **Hashing**       | SHA-256 for gateway lock and tool-call IDs (migrated from SHA-1) |
| **Secrets**       | `detect-secrets` scanning in CI/CD                               |
| **Docker**        | Base images pinned to SHA-256 digests, non-root runtime user     |
| **Node.js**       | Requires >= 22.12.0 (CVE-2025-59466, CVE-2026-21636 patched)     |

Recent hardening: config validation with integer overflow protection, shell injection prevention, type-safe error handling, and concurrency guards. See [`SECURITY.md`](SECURITY.md) for reporting and operational guidance.

## Database Backends

| Database    | Purpose                             | Development | Production        |
| ----------- | ----------------------------------- | ----------- | ----------------- |
| **Qdrant**  | Vector embeddings (RAG)             | In-memory   | VM 10.0.0.50:6333 |
| **Neo4j**   | Knowledge graph memory              | In-memory   | VM 10.0.0.51:7474 |
| **MariaDB** | Relational (repos, KV, personality) | SQLite      | VM 10.0.0.52:3306 |

## Deployment

### Proxmox Layout

```
Proxmox Host (Threadripper, 256 GB RAM)
│
├── LXC 301: openclaw (Gateway + Agent)
│   ├── ws://10.0.0.100:3100  (Gateway)
│   ├── http://10.0.0.100:3101 (Web UI)
│   └── http://10.0.0.100:5180 (AttiClaw)
│
├── VM  302: council-director (mixtral:8x7b, 32 GB)
├── LXC 303-309: council members (T2+T3)
│
├── VM  310: qdrant (vector DB, 4 GB)
├── VM  311: neo4j (graph DB, 8 GB)
└── VM  312: mariadb (SQL, 4 GB)
```

### Docker Compose

```bash
docker compose up -d    # Full stack with Qdrant, Neo4j, MariaDB
```

### Systemd

```bash
sudo systemctl start openclaw    # Gateway + Agent
sudo systemctl start atticlaw    # Web Dashboard
```

## Project Structure

```
.                           Root (fork of openclaw/openclaw)
├── AttiClaw/               YOUR APP — standalone web dashboard
│   ├── src/
│   │   ├── pages/          Dashboard, Chat, Models, Settings, Skills
│   │   ├── stores/         Zustand stores (models, settings, repos)
│   │   ├── components/     ShadCN/UI + layout (sidebar, etc.)
│   │   └── i18n/           EN, ZH, JA translations
│   ├── package.json        Independent from OpenClaw
│   └── vite.config.ts      Dev server on port 5180
│
├── repos/                  Upstream feature source submodules
│   ├── clawx/              ClawX desktop UI (Electron)
│   ├── ironclaw/           Near AI agent infrastructure
│   ├── llama.cpp/          GGUF inference engine
│   ├── zeroclaw/           Zero-shot agent framework
│   ├── nanobot/            Lightweight agent
│   ├── picoclaw/           Edge deployment (RISC-V)
│   ├── artemis/            ARTEMIS AI research (Stanford)
│   └── awesome-openclaw-usecases/
│
├── src/                    OpenClaw core (88+ modules)
│   ├── agent/              Reasoning loop
│   ├── agents/             Agent system (auth, sandbox, tools, skills)
│   ├── auto-reply/         Automated response handling
│   ├── channels/           Communication channel framework
│   ├── cli/                CLI interfaces (gateway, daemon, cron, nodes)
│   ├── commands/           Command handlers
│   ├── config/             Configuration management
│   ├── council/            3-tier LLM council
│   ├── gateway/            WebSocket server + protocol
│   ├── hooks/              Lifecycle hooks
│   ├── infra/              HuggingFace hub + storage client
│   ├── memory/             Graph memory + Neo4j
│   ├── pairing/            Device pairing
│   ├── personality/        Personality system
│   ├── plugins/            Plugin runtime
│   ├── providers/          Multi-provider LLM
│   ├── rag/                Hybrid RAG pipeline
│   ├── rbac/               Role-based access control
│   ├── router/             Smart Router (council-gated)
│   ├── sandbox/            Execution sandbox
│   ├── security/           Security subsystem
│   ├── sessions/           Session management
│   ├── skills/             MCP skill interface
│   ├── tui/                Text UI interface
│   ├── voice/              Real-time voice
│   └── ...                 (88+ modules total)
│
├── Swabble/                Swift SDK package
├── extensions/             37 channel/media extensions
├── skills/                 53 bundled MCP skills
├── apps/                   Native apps (macOS, iOS, Android)
├── packages/               Workspace packages (clawdbot, moltbot)
├── ui/                     Web UI (Vite + Vitest)
├── docs/                   Documentation site (docs.openclaw.ai)
├── deploy/                 Proxmox automation scripts
├── scripts/                Build and utility scripts
├── test/                   E2E and integration tests
├── assets/                 Icons, images, chrome extension
├── vendor/                 Vendored dependencies (a2ui)
├── git-hooks/              Pre-commit hooks
│
├── install-ubuntu.sh       Ubuntu full-stack installer
├── install.sh              Universal installer
├── setup-repos.sh          Submodule init + upstream remotes
├── openclaw.json           Runtime configuration (generated)
└── .gitmodules             Submodule declarations
```

## Configuration

`openclaw.json` — generated by `pnpm openclaw init`:

```jsonc
{
  "version": "2.0.0",
  "useCloudModels": false,
  "agent": { "defaultModel": "llama3.2:3b", "maxTurns": 100 },
  "gateway": {
    "host": "127.0.0.1",
    "port": 3100,
    "allowedOrigins": ["http://localhost:3101", "http://localhost:5180"],
  },
  "memory": { "backend": "hybrid", "maxNodes": 10000 },
  "sandbox": { "enabled": true, "runtime": "wasm" },
  "discovery": { "enabled": true },
}
```

See `src/config/schema.ts` for full JSON Schema.

## Testing

1,375+ test files across src/, test/, and extensions/:

```bash
pnpm test                # Full suite (parallel, Vitest)
pnpm test:fast           # Unit tests only
pnpm test:coverage       # With V8 coverage
pnpm test:all            # Full CI pipeline: lint, build, unit, e2e, live, docker
```

Multiple Vitest configurations for different scopes: unit, e2e, gateway, extensions, and live tests. Coverage thresholds enforced at 70% lines/functions/statements and 55% branches.

Covers: config, council, CSRF, rate limiting, graph memory, Neo4j, SQL, RAG, RBAC, sandbox, skills, vector store, smart router, ClawHub, HuggingFace hub, personality, providers, agents, gateway, Docker, and more.

### Build Toolchain

| Tool              | Purpose             |
| ----------------- | ------------------- |
| TypeScript ^5.9.3 | Type checking       |
| tsdown ^0.20.3    | Bundler             |
| Vitest ^4.0.18    | Test runner         |
| oxlint ^1.49.0    | Linter (type-aware) |
| pnpm 10.23.0      | Package manager     |
| Node.js >= 22.12  | Runtime             |

## CLI Reference

```bash
pnpm openclaw init       # Generate config
pnpm openclaw start      # Start gateway + agent
pnpm openclaw validate   # Validate config
pnpm openclaw status     # System status
pnpm start               # Start everything
pnpm build               # Compile TypeScript
pnpm test                # Run tests
pnpm lint                # oxlint analysis
```

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for guidelines, maintainer list, and PR expectations. Project vision and priorities are in [`VISION.md`](VISION.md).

## License

MIT
