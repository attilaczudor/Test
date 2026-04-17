#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# OpenClaw v2 — Universal Installer
#
# Installs OpenClaw on any Linux/macOS machine (bare-metal, VM, or
# container).  For Proxmox-specific provisioning see
# deploy/install-openclaw.sh.
#
# Usage:
#   bash install.sh                # Interactive (prompts for options)
#   bash install.sh --all          # Full install (core + DBs + ClawX)
#   bash install.sh --core         # Core only (no databases, no ClawX)
#   bash install.sh --docker       # Docker Compose full stack
#   bash install.sh --help         # Show usage
#
# Environment variables:
#   OPENCLAW_DIR        Install directory (default: /opt/openclaw)
#   OPENCLAW_BRANCH     Git branch to clone (default: main)
#   OPENCLAW_SKIP_DB    Skip database provisioning (1 to skip)
#   OPENCLAW_SKIP_CLAWX Skip ClawX desktop build in repos/clawx (1 to skip)
# ──────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────

OPENCLAW_DIR="${OPENCLAW_DIR:-/opt/openclaw}"
OPENCLAW_BRANCH="${OPENCLAW_BRANCH:-main}"
OPENCLAW_REPO="https://github.com/openclaw/openclaw.git"
REQUIRED_NODE_MAJOR=22
REQUIRED_PNPM="10.23.0"

MODE=""          # core | all | docker
SKIP_DB="${OPENCLAW_SKIP_DB:-0}"
SKIP_CLAWX="${OPENCLAW_SKIP_CLAWX:-0}"

# ── Colors & Helpers ──────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERR]${NC}   $*" >&2; }
step()  { echo -e "\n${BOLD}── $1 ──${NC}"; }
banner() {
  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║           OpenClaw v2 — Universal Installer         ║${NC}"
  echo -e "${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
  echo ""
}

# ── Argument Parsing ──────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: install.sh [OPTIONS]

Options:
  --all             Full install: core + databases + ClawX (repos/clawx)
  --core            Core only: source + dependencies + build (no DBs, no ClawX)
  --docker          Deploy full stack via Docker Compose
  --dir PATH        Install directory (default: /opt/openclaw)
  --branch NAME     Git branch to clone (default: main)
  --skip-db         Skip database provisioning
  --skip-clawx      Skip ClawX desktop app build
  --help, -h        Show this help

Examples:
  bash install.sh --all                       # Everything on bare metal
  bash install.sh --core --dir ~/openclaw     # Core only, custom directory
  bash install.sh --docker                    # Full Docker Compose stack
  bash install.sh --all --skip-db             # Core + ClawX, in-memory DBs
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)       MODE="all";    shift ;;
    --core)      MODE="core";   shift ;;
    --docker)    MODE="docker"; shift ;;
    --dir)       OPENCLAW_DIR="$2"; shift 2 ;;
    --branch)    OPENCLAW_BRANCH="$2"; shift 2 ;;
    --skip-db)   SKIP_DB=1; shift ;;
    --skip-clawx) SKIP_CLAWX=1; shift ;;
    --help|-h)   usage ;;
    *)           err "Unknown option: $1"; usage ;;
  esac
done

# ── Interactive Mode Selection ────────────────────────────────────

if [[ -z "$MODE" ]]; then
  banner
  echo "Select installation mode:"
  echo ""
  echo "  1) Full Install     — Core + Databases + ClawX Desktop"
  echo "  2) Core Only        — Source + Dependencies + Build"
  echo "  3) Docker Compose   — Full stack via Docker"
  echo ""
  read -rp "Choice [1/2/3]: " choice
  case "$choice" in
    1) MODE="all" ;;
    2) MODE="core" ;;
    3) MODE="docker" ;;
    *) err "Invalid choice. Exiting."; exit 1 ;;
  esac
fi

banner
info "Mode: ${BOLD}${MODE}${NC}"
info "Directory: ${BOLD}${OPENCLAW_DIR}${NC}"
info "Branch: ${BOLD}${OPENCLAW_BRANCH}${NC}"

# ══════════════════════════════════════════════════════════════════
# Docker Compose mode
# ══════════════════════════════════════════════════════════════════

if [[ "$MODE" == "docker" ]]; then
  step "Checking Docker prerequisites"

  if ! command -v docker &>/dev/null; then
    err "Docker is not installed."
    info "Install Docker: https://docs.docker.com/get-docker/"
    exit 1
  fi
  ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

  if ! docker compose version &>/dev/null; then
    err "Docker Compose V2 is not available."
    info "Install Docker Compose: https://docs.docker.com/compose/install/"
    exit 1
  fi
  ok "Docker Compose $(docker compose version --short)"

  step "Cloning OpenClaw"
  if [[ -d "${OPENCLAW_DIR}/.git" ]]; then
    info "Existing repository found at ${OPENCLAW_DIR}, pulling updates..."
    git -C "${OPENCLAW_DIR}" fetch origin "${OPENCLAW_BRANCH}" && \
    git -C "${OPENCLAW_DIR}" checkout "${OPENCLAW_BRANCH}" && \
    git -C "${OPENCLAW_DIR}" pull origin "${OPENCLAW_BRANCH}"
  else
    mkdir -p "$(dirname "${OPENCLAW_DIR}")"
    git clone --branch "${OPENCLAW_BRANCH}" --depth 1 "${OPENCLAW_REPO}" "${OPENCLAW_DIR}"
  fi
  ok "Source ready at ${OPENCLAW_DIR}"

  step "Starting Docker Compose stack"
  cd "${OPENCLAW_DIR}"
  docker compose up -d --build

  echo ""
  ok "OpenClaw Docker stack is running!"
  echo ""
  echo "  Gateway (WS):  ws://localhost:3100"
  echo "  Web UI:        http://localhost:3101"
  echo "  Qdrant:        http://localhost:6333"
  echo "  Neo4j:         http://localhost:7474"
  echo "  MariaDB:       localhost:3306"
  echo ""
  echo "  Logs:   docker compose -f ${OPENCLAW_DIR}/docker-compose.yml logs -f"
  echo "  Stop:   docker compose -f ${OPENCLAW_DIR}/docker-compose.yml down"
  exit 0
fi

# ══════════════════════════════════════════════════════════════════
# Bare-metal / Core / All modes
# ══════════════════════════════════════════════════════════════════

# ── Detect OS ─────────────────────────────────────────────────────

detect_os() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck source=/dev/null
    . /etc/os-release
    OS_ID="${ID}"
    OS_NAME="${PRETTY_NAME}"
  elif [[ "$(uname)" == "Darwin" ]]; then
    OS_ID="macos"
    OS_NAME="macOS $(sw_vers -productVersion)"
  else
    OS_ID="unknown"
    OS_NAME="$(uname -s)"
  fi
}

detect_os
info "Detected OS: ${BOLD}${OS_NAME}${NC}"

# ── Step 1: System Dependencies ───────────────────────────────────

step "1/7 — System Dependencies"

install_system_deps() {
  case "$OS_ID" in
    ubuntu|debian|pop)
      info "Installing via apt..."
      sudo apt-get update -qq
      sudo apt-get install -y -qq \
        curl git build-essential ca-certificates gnupg \
        python3 python3-pip jq unzip
      ;;
    fedora|rhel|centos|rocky|almalinux)
      info "Installing via dnf..."
      sudo dnf install -y \
        curl git gcc gcc-c++ make ca-certificates gnupg2 \
        python3 python3-pip jq unzip
      ;;
    arch|manjaro)
      info "Installing via pacman..."
      sudo pacman -Syu --noconfirm \
        curl git base-devel ca-certificates gnupg \
        python python-pip jq unzip
      ;;
    macos)
      if ! command -v brew &>/dev/null; then
        warn "Homebrew not found. Installing..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
      fi
      info "Installing via Homebrew..."
      brew install git python3 jq
      ;;
    *)
      warn "Unknown OS '${OS_ID}'. Please install manually: git, curl, build-essential, python3, jq"
      ;;
  esac
}

install_system_deps
ok "System dependencies installed"

# ── Step 2: Node.js ───────────────────────────────────────────────

step "2/7 — Node.js (>= ${REQUIRED_NODE_MAJOR})"

check_node() {
  if command -v node &>/dev/null; then
    local ver
    ver="$(node -v | sed 's/v//')"
    local major
    major="$(echo "$ver" | cut -d. -f1)"
    if [[ "$major" -ge "$REQUIRED_NODE_MAJOR" ]]; then
      ok "Node.js v${ver} (satisfies >= ${REQUIRED_NODE_MAJOR})"
      return 0
    else
      warn "Node.js v${ver} found but >= ${REQUIRED_NODE_MAJOR} required"
      return 1
    fi
  else
    return 1
  fi
}

install_node() {
  info "Installing Node.js ${REQUIRED_NODE_MAJOR} via NodeSource..."
  case "$OS_ID" in
    ubuntu|debian|pop)
      curl -fsSL "https://deb.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x" | sudo -E bash -
      sudo apt-get install -y -qq nodejs
      ;;
    fedora|rhel|centos|rocky|almalinux)
      curl -fsSL "https://rpm.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x" | sudo -E bash -
      sudo dnf install -y nodejs
      ;;
    arch|manjaro)
      sudo pacman -S --noconfirm nodejs npm
      ;;
    macos)
      brew install node@${REQUIRED_NODE_MAJOR}
      ;;
    *)
      err "Cannot auto-install Node.js on ${OS_ID}."
      err "Please install Node.js >= ${REQUIRED_NODE_MAJOR} manually: https://nodejs.org/"
      exit 1
      ;;
  esac
}

if ! check_node; then
  install_node
  check_node || { err "Node.js installation failed"; exit 1; }
fi

# ── Step 3: pnpm ─────────────────────────────────────────────────

step "3/7 — pnpm (>= ${REQUIRED_PNPM})"

if command -v pnpm &>/dev/null; then
  PNPM_VER="$(pnpm --version)"
  ok "pnpm v${PNPM_VER}"
else
  info "Installing pnpm via corepack..."
  if command -v corepack &>/dev/null; then
    corepack enable
    corepack prepare "pnpm@${REQUIRED_PNPM}" --activate
  else
    info "corepack not available, using npm..."
    npm install -g "pnpm@${REQUIRED_PNPM}"
  fi
  ok "pnpm v$(pnpm --version)"
fi

# ── Step 4: Clone / Update Source ─────────────────────────────────

step "4/7 — OpenClaw Source"

if [[ -d "${OPENCLAW_DIR}/.git" ]]; then
  info "Existing repository found at ${OPENCLAW_DIR}"
  info "Fetching latest from ${OPENCLAW_BRANCH}..."
  git -C "${OPENCLAW_DIR}" fetch origin "${OPENCLAW_BRANCH}"
  git -C "${OPENCLAW_DIR}" checkout "${OPENCLAW_BRANCH}"
  git -C "${OPENCLAW_DIR}" pull origin "${OPENCLAW_BRANCH}"
  ok "Updated to latest ${OPENCLAW_BRANCH}"
else
  info "Cloning ${OPENCLAW_REPO} (branch: ${OPENCLAW_BRANCH})..."
  mkdir -p "$(dirname "${OPENCLAW_DIR}")"
  git clone --branch "${OPENCLAW_BRANCH}" "${OPENCLAW_REPO}" "${OPENCLAW_DIR}"
  ok "Cloned to ${OPENCLAW_DIR}"
fi

cd "${OPENCLAW_DIR}"

# Initialize submodules (repos/clawx, repos/ironclaw, etc.)
if [[ -f ".gitmodules" ]]; then
  info "Initializing git submodules..."
  git submodule update --init --recursive
  ok "Submodules initialized"
fi

# ── Step 5: Install Dependencies & Build ──────────────────────────

step "5/7 — Dependencies & Build"

info "Installing npm dependencies via pnpm..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
ok "Dependencies installed"

info "Building TypeScript..."
pnpm build
ok "Build complete"

# Generate default config if none exists
if [[ ! -f "openclaw.json" ]]; then
  info "Generating default openclaw.json..."
  cat > openclaw.json <<'CONFIG'
{
  "version": "2.0.0",
  "useCloudModels": false,
  "agent": {
    "defaultModel": "llama3.2:3b",
    "maxTurns": 100,
    "temperature": 0.7
  },
  "gateway": {
    "host": "127.0.0.1",
    "port": 3100,
    "allowedOrigins": ["http://localhost:3101"]
  },
  "memory": {
    "backend": "hybrid",
    "maxNodes": 10000,
    "autoSummarize": true,
    "persistPath": "./data"
  },
  "sandbox": {
    "enabled": true,
    "runtime": "wasm",
    "maxMemoryMb": 512,
    "maxCpuSeconds": 30,
    "allowNetwork": false
  },
  "rbac": {
    "enabled": true,
    "defaultRole": "agent"
  },
  "discovery": {
    "enabled": true,
    "scanIntervalMs": 30000
  },
  "router": {
    "confidenceThreshold": 0.6,
    "maxCostPerRequest": 0.50,
    "maxDailySpend": 10.00
  },
  "lora": {
    "enabled": true,
    "rank": 16,
    "qualityThreshold": 0.7,
    "minTrainingExamples": 50
  }
}
CONFIG
  ok "Created openclaw.json with secure defaults"
fi

mkdir -p data

# ── Step 6: Databases (optional) ──────────────────────────────────

step "6/7 — Databases"

if [[ "$SKIP_DB" == "1" || "$MODE" == "core" ]]; then
  info "Skipping database provisioning (using in-memory/SQLite fallback)"
  ok "Databases skipped"
else
  info "Setting up database backends via Docker Compose..."

  if ! command -v docker &>/dev/null; then
    warn "Docker not found — databases will use in-memory/SQLite fallback"
    warn "Install Docker for production databases: https://docs.docker.com/get-docker/"
  else
    # Start only the database services
    if [[ -f "docker-compose.yml" ]]; then
      docker compose up -d qdrant neo4j mariadb
      ok "Database containers started"
      echo ""
      echo "  Qdrant:   http://localhost:6333  (vector store)"
      echo "  Neo4j:    http://localhost:7474  (knowledge graph)"
      echo "  MariaDB:  localhost:3306         (relational DB)"
    else
      warn "docker-compose.yml not found, skipping database containers"
    fi
  fi
fi

# ── Step 7: ClawX Desktop App (optional) ──────────────────────────

step "7/7 — ClawX Desktop App"

if [[ "$SKIP_CLAWX" == "1" || "$MODE" == "core" ]]; then
  info "Skipping ClawX desktop app build"
  ok "ClawX skipped"
else
  CLAWX_DIR="${OPENCLAW_DIR}/repos/clawx"
  if [[ -d "$CLAWX_DIR" ]]; then
    info "Building ClawX desktop app..."
    cd "$CLAWX_DIR"

    if [[ -f "package.json" ]]; then
      # Install ClawX dependencies
      if command -v pnpm &>/dev/null; then
        pnpm install 2>/dev/null || npm install
      else
        npm install
      fi

      # Build the Electron app
      if grep -q '"build"' package.json 2>/dev/null; then
        pnpm build 2>/dev/null || npm run build || warn "ClawX build encountered errors"
      fi
      ok "ClawX desktop app built"
    else
      warn "ClawX package.json not found, skipping build"
    fi

    cd "${OPENCLAW_DIR}"
  else
    warn "ClawX directory not found at ${CLAWX_DIR}"
    info "ClawX may need to be initialized via: git submodule update --init"
  fi
fi

# ── Install LLM Backend (guidance) ───────────────────────────────

step "LLM Backend Setup"

if command -v ollama &>/dev/null; then
  ok "Ollama detected: $(ollama --version 2>/dev/null || echo 'installed')"
  info "Pull a model: ollama pull llama3.2:3b"
else
  info "No local LLM backend detected."
  echo ""
  echo "  Install one of the following:"
  echo ""
  echo "  Ollama (recommended):"
  echo "    curl -fsSL https://ollama.ai/install.sh | sh"
  echo "    ollama pull llama3.2:3b"
  echo ""
  echo "  llama.cpp:"
  echo "    git clone https://github.com/ggerganov/llama.cpp"
  echo "    cd llama.cpp && cmake -B build && cmake --build build --config Release"
  echo "    ./build/bin/llama-server -m <model.gguf> --port 8080"
  echo ""
  echo "  vLLM:"
  echo "    pip install vllm"
  echo "    vllm serve <model-name>"
  echo ""
  echo "  LM Studio:"
  echo "    Download from https://lmstudio.ai"
  echo ""
fi

# ── Create systemd service (Linux only) ──────────────────────────

if [[ "$OS_ID" != "macos" ]] && command -v systemctl &>/dev/null; then
  step "Systemd Service"

  SERVICE_FILE="/etc/systemd/system/openclaw.service"
  if [[ ! -f "$SERVICE_FILE" ]]; then
    info "Creating systemd service..."
    sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=OpenClaw v2 Autonomous Agency Framework
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${OPENCLAW_DIR}
ExecStart=$(command -v node) ${OPENCLAW_DIR}/dist/cli.js start
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=OPENCLAW_CONFIG=${OPENCLAW_DIR}/openclaw.json

[Install]
WantedBy=multi-user.target
EOF
    sudo systemctl daemon-reload
    sudo systemctl enable openclaw
    ok "Systemd service created and enabled"
    info "Start with: sudo systemctl start openclaw"
  else
    ok "Systemd service already exists"
  fi
fi

# ── Summary ───────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║         OpenClaw v2 installed successfully!         ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  Location:     ${OPENCLAW_DIR}"
echo "  Config:       ${OPENCLAW_DIR}/openclaw.json"
echo "  Data:         ${OPENCLAW_DIR}/data/"
echo ""
echo "  Quick Start:"
echo "    cd ${OPENCLAW_DIR}"
echo "    pnpm start                     # Start gateway + agent"
echo ""
echo "  Services:"
echo "    Gateway:    ws://localhost:3100"
echo "    Web UI:     http://localhost:3101"
echo ""
echo "  Commands:"
echo "    pnpm openclaw init             # Re-generate config"
echo "    pnpm openclaw start            # Start everything"
echo "    pnpm openclaw validate         # Validate config"
echo "    pnpm openclaw status           # System status"
echo "    pnpm test                      # Run test suite (543+ tests)"
echo ""
echo "  Desktop App (ClawX):"
echo "    cd ${OPENCLAW_DIR}/repos/clawx"
echo "    pnpm dev                       # Start in dev mode"
echo ""
echo "  Proxmox Deployment:"
echo "    bash deploy/install-openclaw.sh --type lxc --vmid 301"
echo "    bash deploy/setup-council.sh"
echo "    bash deploy/setup-databases.sh"
echo ""
echo "  Council Setup:"
echo "    bash deploy/setup-council.sh --base-vmid 302"
echo ""
echo "  Documentation:"
echo "    https://github.com/openclaw/openclaw#readme"
echo ""
