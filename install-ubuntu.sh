#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# AttiClaw + OpenClaw — Ubuntu Installer
#
# Installs the full AttiClaw stack on Ubuntu (22.04 / 24.04):
#   - System dependencies (build tools, SMB, NVMe tools)
#   - Node.js 22 + pnpm
#   - OpenClaw core (upstream fork)
#   - All upstream feature submodules
#   - AttiClaw web app (your app)
#   - Ollama LLM backend
#   - SMB/NVMe storage tools
#   - Systemd services
#
# Usage:
#   sudo bash install-ubuntu.sh              # Full interactive install
#   sudo bash install-ubuntu.sh --headless   # Non-interactive (all defaults)
#   sudo bash install-ubuntu.sh --help       # Show usage
#
# Requires: Ubuntu 22.04+ with root/sudo access
# ──────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────

INSTALL_DIR="${ATTICLAW_DIR:-/opt/atticlaw}"
BRANCH="${ATTICLAW_BRANCH:-main}"
REPO_URL="${ATTICLAW_REPO:-https://github.com/attilaczudor/Test.git}"
NODE_MAJOR=22
HEADLESS=0
SKIP_OLLAMA=0
SKIP_SMB=0

# SMB defaults (user configures via AttiClaw Settings UI)
SMB_MOUNT="/mnt/smb-models"
NVME_MOUNT="/mnt/nvme-models"

# ── Colors ────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()      { echo -e "${GREEN}[ OK ]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()     { echo -e "${RED}[ERR ]${NC}  $*" >&2; }
step()    { echo -e "\n${BOLD}━━ $1 ━━${NC}"; }
divider() { echo -e "${CYAN}────────────────────────────────────────────────${NC}"; }

banner() {
  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║       AttiClaw — Ubuntu Full Stack Installer        ║${NC}"
  echo -e "${BOLD}║                                                      ║${NC}"
  echo -e "${BOLD}║   Personal AI Model Management & Inference Platform  ║${NC}"
  echo -e "${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
  echo ""
}

# ── Argument Parsing ──────────────────────────────────────────────

usage() {
  cat <<'EOF'
Usage: install-ubuntu.sh [OPTIONS]

Options:
  --headless         Non-interactive install with all defaults
  --dir PATH         Install directory (default: /opt/atticlaw)
  --branch NAME      Git branch (default: main)
  --skip-ollama      Skip Ollama installation
  --skip-smb         Skip SMB/CIFS tools
  --help, -h         Show this help

Environment Variables:
  ATTICLAW_DIR       Install directory override
  ATTICLAW_BRANCH    Git branch override
  ATTICLAW_REPO      Git repository URL override

Examples:
  sudo bash install-ubuntu.sh                       # Full install
  sudo bash install-ubuntu.sh --headless             # Unattended
  sudo bash install-ubuntu.sh --dir ~/atticlaw       # Custom path
  sudo bash install-ubuntu.sh --skip-ollama          # No Ollama
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --headless)     HEADLESS=1; shift ;;
    --dir)          INSTALL_DIR="$2"; shift 2 ;;
    --branch)       BRANCH="$2"; shift 2 ;;
    --skip-ollama)  SKIP_OLLAMA=1; shift ;;
    --skip-smb)     SKIP_SMB=1; shift ;;
    --help|-h)      usage ;;
    *)              err "Unknown option: $1"; usage ;;
  esac
done

# ── Preflight ─────────────────────────────────────────────────────

banner

# Check Ubuntu
if ! grep -qi 'ubuntu' /etc/os-release 2>/dev/null; then
  err "This script is designed for Ubuntu. Detected: $(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME || echo 'unknown')"
  err "For other distros, use install.sh instead."
  exit 1
fi

UBUNTU_VER=$(grep VERSION_ID /etc/os-release | cut -d'"' -f2)
info "Ubuntu ${UBUNTU_VER} detected"
info "Install directory: ${BOLD}${INSTALL_DIR}${NC}"
info "Branch: ${BOLD}${BRANCH}${NC}"

if [[ "$HEADLESS" == "0" ]]; then
  echo ""
  read -rp "Proceed with installation? [Y/n] " confirm
  if [[ "${confirm,,}" == "n" ]]; then
    info "Installation cancelled."
    exit 0
  fi
fi

# ══════════════════════════════════════════════════════════════════
# Step 1: System Dependencies
# ══════════════════════════════════════════════════════════════════

step "1/9 — System Dependencies"

export DEBIAN_FRONTEND=noninteractive

info "Updating package lists..."
apt-get update -qq

info "Installing build tools and essentials..."
apt-get install -y -qq \
  curl wget git build-essential ca-certificates gnupg lsb-release \
  python3 python3-pip python3-venv \
  jq unzip htop tree \
  apt-transport-https software-properties-common

ok "System dependencies installed"

# ══════════════════════════════════════════════════════════════════
# Step 2: SMB/CIFS + NVMe Tools
# ══════════════════════════════════════════════════════════════════

step "2/9 — Storage Tools (SMB + NVMe)"

if [[ "$SKIP_SMB" == "0" ]]; then
  info "Installing CIFS/SMB client tools..."
  apt-get install -y -qq cifs-utils smbclient

  info "Installing NVMe management tools..."
  apt-get install -y -qq nvme-cli

  # Create mount points
  mkdir -p "$SMB_MOUNT" "$NVME_MOUNT"
  chmod 755 "$SMB_MOUNT" "$NVME_MOUNT"

  ok "SMB + NVMe tools installed"
  info "SMB mount point: ${SMB_MOUNT}"
  info "NVMe mount point: ${NVME_MOUNT}"
else
  warn "Skipping SMB/NVMe tools (--skip-smb)"
fi

# ══════════════════════════════════════════════════════════════════
# Step 3: Node.js 22
# ══════════════════════════════════════════════════════════════════

step "3/9 — Node.js ${NODE_MAJOR}"

NEED_NODE=1
if command -v node &>/dev/null; then
  CURRENT_NODE=$(node -v | sed 's/v//' | cut -d. -f1)
  if [[ "$CURRENT_NODE" -ge "$NODE_MAJOR" ]]; then
    ok "Node.js $(node -v) already installed"
    NEED_NODE=0
  else
    warn "Node.js v${CURRENT_NODE} found, need >= ${NODE_MAJOR}"
  fi
fi

if [[ "$NEED_NODE" == "1" ]]; then
  info "Installing Node.js ${NODE_MAJOR} via NodeSource..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
  ok "Node.js $(node -v) installed"
fi

# ══════════════════════════════════════════════════════════════════
# Step 4: pnpm
# ══════════════════════════════════════════════════════════════════

step "4/9 — pnpm"

if command -v pnpm &>/dev/null; then
  ok "pnpm $(pnpm --version) already installed"
else
  info "Installing pnpm via corepack..."
  if command -v corepack &>/dev/null; then
    corepack enable
    corepack prepare pnpm@latest --activate
  else
    info "corepack unavailable, using npm..."
    npm install -g pnpm
  fi
  ok "pnpm $(pnpm --version) installed"
fi

# ══════════════════════════════════════════════════════════════════
# Step 5: Clone Repository
# ══════════════════════════════════════════════════════════════════

step "5/9 — Clone Repository"

if [[ -d "${INSTALL_DIR}/.git" ]]; then
  info "Existing repo at ${INSTALL_DIR}, pulling latest..."
  git -C "${INSTALL_DIR}" fetch origin "${BRANCH}"
  git -C "${INSTALL_DIR}" checkout "${BRANCH}"
  git -C "${INSTALL_DIR}" pull origin "${BRANCH}"
  ok "Updated to latest ${BRANCH}"
else
  info "Cloning ${REPO_URL} (branch: ${BRANCH})..."
  mkdir -p "$(dirname "${INSTALL_DIR}")"
  git clone --branch "${BRANCH}" "${REPO_URL}" "${INSTALL_DIR}"
  ok "Cloned to ${INSTALL_DIR}"
fi

cd "${INSTALL_DIR}"

# ══════════════════════════════════════════════════════════════════
# Step 6: Initialize All Submodules
# ══════════════════════════════════════════════════════════════════

step "6/9 — Upstream Feature Submodules"

info "Initializing all submodules..."
git submodule update --init --recursive

# Set upstream remotes
if [[ -f "setup-repos.sh" ]]; then
  info "Configuring upstream remotes..."
  bash setup-repos.sh 2>/dev/null || true
fi

divider
info "Submodule structure:"
echo "  repos/clawx/                 — upstream desktop UI (Electron)"
echo "  repos/ironclaw/              — Near AI agent infrastructure"
echo "  repos/llama.cpp/             — GGUF inference engine"
echo "  repos/awesome-openclaw-usecases/ — curated use cases"
echo "  repos/nanobot/               — lightweight agent framework"
echo "  repos/picoclaw/              — edge deployment"
echo "  repos/zeroclaw/              — zero-shot agent framework"
echo "  repos/artemis/               — ARTEMIS AI research framework (Stanford)"
divider

ok "All submodules initialized"

# ══════════════════════════════════════════════════════════════════
# Step 7: Build OpenClaw Core
# ══════════════════════════════════════════════════════════════════

step "7/9 — OpenClaw Core (Dependencies + Build)"

info "Installing OpenClaw dependencies..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
ok "Dependencies installed"

info "Building OpenClaw TypeScript..."
pnpm build 2>/dev/null || warn "Build had warnings (non-fatal)"
ok "OpenClaw core built"

# Generate default config
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
    "allowedOrigins": ["http://localhost:3101", "http://localhost:5180"]
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
  "discovery": {
    "enabled": true,
    "scanIntervalMs": 30000
  }
}
CONFIG
  ok "Created openclaw.json"
fi

mkdir -p data

# ══════════════════════════════════════════════════════════════════
# Step 8: Build AttiClaw Web App
# ══════════════════════════════════════════════════════════════════

step "8/9 — AttiClaw Web App"

ATTICLAW_APP="${INSTALL_DIR}/AttiClaw"
if [[ -d "$ATTICLAW_APP" && -f "$ATTICLAW_APP/package.json" ]]; then
  info "Installing AttiClaw dependencies..."
  cd "$ATTICLAW_APP"
  pnpm install 2>/dev/null || npm install
  ok "AttiClaw dependencies installed"

  info "Building AttiClaw..."
  pnpm build 2>/dev/null || warn "AttiClaw build had warnings"
  ok "AttiClaw built (dist/)"

  cd "${INSTALL_DIR}"
else
  warn "AttiClaw directory not found at ${ATTICLAW_APP}"
fi

# ══════════════════════════════════════════════════════════════════
# Step 9: Ollama LLM Backend
# ══════════════════════════════════════════════════════════════════

step "9/9 — Ollama LLM Backend"

if [[ "$SKIP_OLLAMA" == "0" ]]; then
  if command -v ollama &>/dev/null; then
    ok "Ollama already installed: $(ollama --version 2>/dev/null || echo 'detected')"
  else
    info "Installing Ollama..."
    curl -fsSL https://ollama.ai/install.sh | sh
    ok "Ollama installed"
  fi

  # Enable and start Ollama service
  if command -v systemctl &>/dev/null; then
    systemctl enable ollama 2>/dev/null || true
    systemctl start ollama 2>/dev/null || true
    ok "Ollama service enabled"
  fi

  echo ""
  info "Pull a model to get started:"
  echo "  ollama pull llama3.2:3b        # 2 GB, fast general chat"
  echo "  ollama pull qwen2.5-coder:7b   # 4.4 GB, code generation"
  echo "  ollama pull nomic-embed-text    # 274 MB, embeddings for RAG"
else
  warn "Skipping Ollama (--skip-ollama)"
  echo ""
  info "Install an LLM backend manually:"
  echo "  Ollama:    curl -fsSL https://ollama.ai/install.sh | sh"
  echo "  vLLM:      pip install vllm"
  echo "  llama.cpp: see repos/llama.cpp/"
fi

# ══════════════════════════════════════════════════════════════════
# Systemd Services
# ══════════════════════════════════════════════════════════════════

if command -v systemctl &>/dev/null; then
  step "Systemd Services"

  # OpenClaw gateway service
  OPENCLAW_SERVICE="/etc/systemd/system/openclaw.service"
  if [[ ! -f "$OPENCLAW_SERVICE" ]]; then
    info "Creating openclaw.service..."
    cat > "$OPENCLAW_SERVICE" <<EOF
[Unit]
Description=OpenClaw Gateway + Agent
After=network.target ollama.service
Wants=ollama.service

[Service]
Type=simple
User=$(logname 2>/dev/null || echo root)
WorkingDirectory=${INSTALL_DIR}
ExecStart=$(command -v node) ${INSTALL_DIR}/dist/cli.js start
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=OPENCLAW_CONFIG=${INSTALL_DIR}/openclaw.json

[Install]
WantedBy=multi-user.target
EOF
    ok "openclaw.service created"
  fi

  # AttiClaw dev service (optional — for preview server)
  ATTICLAW_SERVICE="/etc/systemd/system/atticlaw.service"
  if [[ ! -f "$ATTICLAW_SERVICE" ]]; then
    info "Creating atticlaw.service..."
    cat > "$ATTICLAW_SERVICE" <<EOF
[Unit]
Description=AttiClaw Web Dashboard
After=network.target openclaw.service
Wants=openclaw.service

[Service]
Type=simple
User=$(logname 2>/dev/null || echo root)
WorkingDirectory=${INSTALL_DIR}/AttiClaw
ExecStart=$(command -v npx) vite preview --port 5180 --host 0.0.0.0
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
    ok "atticlaw.service created"
  fi

  systemctl daemon-reload
  systemctl enable openclaw 2>/dev/null || true
  systemctl enable atticlaw 2>/dev/null || true

  info "Start services:"
  echo "  sudo systemctl start openclaw    # Gateway + Agent"
  echo "  sudo systemctl start atticlaw    # Web Dashboard"
fi

# ══════════════════════════════════════════════════════════════════
# SMB Auto-mount (fstab entry)
# ══════════════════════════════════════════════════════════════════

if [[ "$SKIP_SMB" == "0" ]]; then
  step "SMB Storage Setup"

  info "SMB mount point created at: ${SMB_MOUNT}"
  info "NVMe cache point created at: ${NVME_MOUNT}"
  echo ""
  info "To mount your SMB share, add to /etc/fstab:"
  echo "  //192.168.1.100/models  ${SMB_MOUNT}  cifs  credentials=/root/.smb-credentials,uid=1000,gid=1000  0  0"
  echo ""
  info "Create credentials file:"
  echo "  echo -e 'username=YOUR_USER\npassword=YOUR_PASS' > /root/.smb-credentials"
  echo "  chmod 600 /root/.smb-credentials"
  echo ""
  info "Or configure SMB in the AttiClaw Settings UI."
fi

# ══════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║         Installation Complete!                       ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BOLD}Installed Components:${NC}"
echo "  OpenClaw Core     ${INSTALL_DIR}/"
echo "  AttiClaw App      ${INSTALL_DIR}/AttiClaw/"
echo "  Config            ${INSTALL_DIR}/openclaw.json"
echo ""
echo -e "${BOLD}Upstream Feature Sources (submodules):${NC}"
echo "  repos/clawx        → ValueCell-ai/ClawX (desktop UI)"
echo "  repos/ironclaw     → nearai/ironclaw (agent infra)"
echo "  repos/llama.cpp    → ggml-org/llama.cpp (inference)"
echo "  repos/nanobot      → HKUDS/nanobot (lightweight agent)"
echo "  repos/picoclaw     → sipeed/picoclaw (edge deploy)"
echo "  repos/zeroclaw     → zeroclaw-labs/zeroclaw (zero-shot)"
echo "  repos/artemis       → Stanford-Trinity/ARTEMIS (AI research)"
echo "  repos/awesome-openclaw-usecases → anthropics/awesome-openclaw-usecases"
echo ""
echo -e "${BOLD}Storage Architecture:${NC}"
echo "  SMB (permanent)   ${SMB_MOUNT}  — all models, datasets, files"
echo "  NVMe (runtime)    ${NVME_MOUNT} — running models only (fast cache)"
echo ""
echo -e "${BOLD}Quick Start:${NC}"
echo "  cd ${INSTALL_DIR}"
echo ""
echo "  # Start OpenClaw backend"
echo "  pnpm start"
echo ""
echo "  # Start AttiClaw web dashboard (separate terminal)"
echo "  cd AttiClaw && pnpm dev"
echo "  # Open http://localhost:5180"
echo ""
echo "  # Or use systemd services"
echo "  sudo systemctl start openclaw"
echo "  sudo systemctl start atticlaw"
echo ""
echo -e "${BOLD}Services:${NC}"
echo "  OpenClaw Gateway   ws://localhost:3100"
echo "  OpenClaw Web UI    http://localhost:3101"
echo "  AttiClaw Dashboard http://localhost:5180"
echo ""
echo -e "${BOLD}Model Management:${NC}"
echo "  ollama pull llama3.2:3b          # Pull a chat model"
echo "  ollama pull qwen2.5-coder:7b     # Pull a code model"
echo "  # Or browse HuggingFace models via AttiClaw Models page"
echo ""
echo -e "${BOLD}Update repos:${NC}"
echo "  ./setup-repos.sh --update        # Fetch all upstreams"
echo ""
