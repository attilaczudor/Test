#!/usr/bin/env bash
# setup-repos.sh — Initialize all upstream feature submodules
#
# Architecture:
#   This repo (Test) = your fork of openclaw/openclaw
#   AttiClaw/        = YOUR app (standalone, not a submodule)
#   repos/           = upstream feature sources (submodules):
#     clawx/                     ← ValueCell-ai/ClawX (desktop UI, Electron)
#     ironclaw/                  ← nearai/ironclaw (AI agent infrastructure)
#     llama.cpp/                 ← ggml-org/llama.cpp (inference engine)
#     awesome-openclaw-usecases/ ← anthropics/awesome-openclaw-usecases
#     nanobot/                   ← HKUDS/nanobot (lightweight agent)
#     picoclaw/                  ← sipeed/picoclaw (edge deployment)
#     zeroclaw/                  ← zeroclaw-labs/zeroclaw (zero-shot agent framework)
#     artemis/                   ← Stanford-Trinity/ARTEMIS (AI research framework)
#
# Usage:
#   ./setup-repos.sh           # Initialize all submodules
#   ./setup-repos.sh --update  # Fetch latest from all upstreams

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Upstream mappings (fork → upstream) ─────────────────────────
declare -A UPSTREAMS=(
  ["repos/clawx"]="https://github.com/ValueCell-ai/ClawX"
  ["repos/ironclaw"]="https://github.com/nearai/ironclaw"
  ["repos/llama.cpp"]="https://github.com/ggml-org/llama.cpp"
  ["repos/awesome-openclaw-usecases"]="https://github.com/anthropics/awesome-openclaw-usecases"
  ["repos/nanobot"]="https://github.com/HKUDS/nanobot"
  ["repos/picoclaw"]="https://github.com/sipeed/picoclaw"
  ["repos/zeroclaw"]="https://github.com/zeroclaw-labs/zeroclaw"
  ["repos/artemis"]="https://github.com/Stanford-Trinity/ARTEMIS"
)

# ── Initialize submodules ───────────────────────────────────────

init_submodules() {
  echo -e "${CYAN}Initializing submodules...${NC}"
  git submodule update --init --recursive

  echo -e "${GREEN}All submodules initialized.${NC}"
  echo ""

  # Add upstream remotes to each submodule
  for submod in "${!UPSTREAMS[@]}"; do
    upstream_url="${UPSTREAMS[$submod]}"
    if [ -d "$submod/.git" ] || [ -f "$submod/.git" ]; then
      echo -e "${CYAN}Setting upstream for ${submod}...${NC}"
      (
        cd "$submod"
        if ! git remote get-url upstream &>/dev/null; then
          git remote add upstream "$upstream_url"
          echo -e "  ${GREEN}Added upstream: ${upstream_url}${NC}"
        else
          echo -e "  ${YELLOW}Upstream already set${NC}"
        fi
      )
    else
      echo -e "  ${YELLOW}${submod} not cloned yet — run 'git submodule update --init'${NC}"
    fi
  done
}

# ── Update all upstreams ────────────────────────────────────────

update_upstreams() {
  echo -e "${CYAN}Fetching latest from all upstreams...${NC}"
  echo ""

  # Main repo (openclaw/openclaw)
  echo -e "${CYAN}[main repo] Fetching upstream openclaw/openclaw...${NC}"
  git fetch upstream --no-tags 2>/dev/null || echo -e "  ${YELLOW}Skipped (no upstream remote)${NC}"
  echo ""

  # Submodules
  for submod in "${!UPSTREAMS[@]}"; do
    if [ -d "$submod/.git" ] || [ -f "$submod/.git" ]; then
      echo -e "${CYAN}[${submod}] Fetching upstream...${NC}"
      (
        cd "$submod"
        git fetch upstream --no-tags 2>/dev/null || echo -e "  ${YELLOW}Skipped${NC}"
      )
    fi
  done

  echo ""
  echo -e "${GREEN}All upstreams fetched.${NC}"
  echo -e "To merge upstream changes into a submodule:"
  echo -e "  cd repos/ironclaw && git merge upstream/main"
}

# ── Status ──────────────────────────────────────────────────────

show_status() {
  echo -e "${CYAN}Repository structure:${NC}"
  echo ""
  echo "  . (this repo)        → fork of openclaw/openclaw"
  echo "  AttiClaw/            → YOUR app (standalone, not submodule)"

  for submod in repos/clawx repos/ironclaw repos/llama.cpp repos/awesome-openclaw-usecases repos/nanobot repos/picoclaw repos/zeroclaw repos/artemis; do
    if [ -d "$submod/.git" ] || [ -f "$submod/.git" ]; then
      echo -e "  ${submod}/  → submodule: ${GREEN}initialized${NC}"
    else
      echo -e "  ${submod}/  → submodule: ${YELLOW}not initialized${NC}"
    fi
  done
}

# ── Main ────────────────────────────────────────────────────────

case "${1:-init}" in
  --update|-u)
    update_upstreams
    ;;
  --status|-s)
    show_status
    ;;
  *)
    init_submodules
    echo ""
    show_status
    ;;
esac
