#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# OpenClaw v2 — Dedicated Database VM Setup
#
# Creates and provisions Proxmox VMs for:
#   VMID 310 — Qdrant (Vector Database)    port 6333 (REST), 6334 (gRPC)
#   VMID 311 — Neo4j (Knowledge Graph)     port 7474 (HTTP), 7687 (Bolt)
#   VMID 312 — MariaDB (Relational DB)     port 3306 (MySQL)
#
# Network: Internal bridge vmbr1 (10.0.0.0/24)
#   Qdrant:  10.0.0.50
#   Neo4j:   10.0.0.51
#   MariaDB: 10.0.0.52
#
# Prerequisites:
#   - Proxmox VE host with vmbr1 configured
#   - Debian/Ubuntu cloud image template (template ID 9000)
#   - SSH key provisioned for root access
#
# Usage:
#   bash deploy/setup-databases.sh [--qdrant-only | --neo4j-only | --mariadb-only]
# ──────────────────────────────────────────────────────────────

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────
#
# Reference host: 16-core / 128 GB RAM Proxmox VE
#
#   Database VMs total:  6 cores, 16 GB RAM, 96 GB disk
#   Remaining for host:  10 cores, 112 GB RAM → council + agent
#

PROXMOX_NODE="${PROXMOX_NODE:-pve}"
TEMPLATE_ID="${TEMPLATE_ID:-9000}"
STORAGE="${STORAGE:-local-zfs}"
BRIDGE="${BRIDGE:-vmbr1}"
SSH_KEY="${SSH_KEY:-/root/.ssh/id_ed25519.pub}"

# Qdrant VM — 2c / 4 GB / 32 GB
QDRANT_VMID=310
QDRANT_IP="10.0.0.50/24"
QDRANT_GW="10.0.0.1"
QDRANT_CORES=2
QDRANT_MEM=4096    # 4GB — Qdrant is efficient with memory-mapped segments
QDRANT_DISK="32G"
QDRANT_VERSION="${QDRANT_VERSION:-latest}"

# Neo4j VM — 2c / 8 GB / 32 GB
NEO4J_VMID=311
NEO4J_IP="10.0.0.51/24"
NEO4J_GW="10.0.0.1"
NEO4J_CORES=2
NEO4J_MEM=8192     # 8GB — heap 2g + page cache 2g + overhead
NEO4J_DISK="32G"
NEO4J_VERSION="${NEO4J_VERSION:-5}"

# MariaDB VM — 2c / 4 GB / 32 GB
MARIADB_VMID=312
MARIADB_IP="10.0.0.52/24"
MARIADB_GW="10.0.0.1"
MARIADB_CORES=2
MARIADB_MEM=4096     # 4GB — MariaDB for standard relational storage
MARIADB_DISK="32G"
MARIADB_VERSION="${MARIADB_VERSION:-11}"

# ─── Helper Functions ─────────────────────────────────────────

log() { echo "[$(date '+%H:%M:%S')] $*"; }
err() { echo "[$(date '+%H:%M:%S')] ERROR: $*" >&2; }

vm_exists() {
  qm status "$1" &>/dev/null
}

wait_for_ssh() {
  local ip="${1%%/*}" max_wait=120 elapsed=0
  log "Waiting for SSH on $ip..."
  while ! ssh -o ConnectTimeout=3 -o StrictHostKeyChecking=no "root@$ip" true &>/dev/null; do
    sleep 5
    elapsed=$((elapsed + 5))
    if [ "$elapsed" -ge "$max_wait" ]; then
      err "SSH timeout for $ip after ${max_wait}s"
      return 1
    fi
  done
  log "SSH ready on $ip"
}

# ─── Create Qdrant VM ─────────────────────────────────────────

setup_qdrant() {
  log "=== Setting up Qdrant Vector Database (VMID $QDRANT_VMID) ==="

  if vm_exists "$QDRANT_VMID"; then
    log "VM $QDRANT_VMID already exists — skipping creation"
  else
    log "Cloning template $TEMPLATE_ID → VM $QDRANT_VMID"
    qm clone "$TEMPLATE_ID" "$QDRANT_VMID" \
      --name "openclaw-qdrant" \
      --full true \
      --storage "$STORAGE"

    qm set "$QDRANT_VMID" \
      --cores "$QDRANT_CORES" \
      --memory "$QDRANT_MEM" \
      --net0 "virtio,bridge=$BRIDGE" \
      --ipconfig0 "ip=$QDRANT_IP,gw=$QDRANT_GW" \
      --sshkeys "$SSH_KEY" \
      --onboot 1 \
      --description "OpenClaw Qdrant Vector DB — port 6333"

    qm resize "$QDRANT_VMID" scsi0 "$QDRANT_DISK"

    log "Starting VM $QDRANT_VMID"
    qm start "$QDRANT_VMID"
  fi

  local ip="${QDRANT_IP%%/*}"
  wait_for_ssh "$QDRANT_IP"

  log "Installing Qdrant via Docker..."
  ssh -o StrictHostKeyChecking=no "root@$ip" bash -s <<'QDRANT_SETUP'
set -euo pipefail

# Install Docker if not present
if ! command -v docker &>/dev/null; then
  apt-get update -qq
  apt-get install -y -qq docker.io
  systemctl enable --now docker
fi

# Create persistent storage directory
mkdir -p /var/lib/qdrant/storage

# Stop existing container if running
docker stop qdrant 2>/dev/null || true
docker rm qdrant 2>/dev/null || true

# Run Qdrant
docker run -d \
  --name qdrant \
  --restart unless-stopped \
  -p 6333:6333 \
  -p 6334:6334 \
  -v /var/lib/qdrant/storage:/qdrant/storage:z \
  -e QDRANT__SERVICE__GRPC_PORT=6334 \
  qdrant/qdrant:QDRANT_VERSION_PLACEHOLDER

# Wait for Qdrant to be ready
for i in $(seq 1 30); do
  if curl -sf http://localhost:6333/healthz >/dev/null 2>&1; then
    echo "Qdrant is ready"
    break
  fi
  sleep 2
done
QDRANT_SETUP

  # Replace version placeholder
  ssh -o StrictHostKeyChecking=no "root@$ip" \
    "docker rm -f qdrant 2>/dev/null; docker run -d --name qdrant --restart unless-stopped -p 6333:6333 -p 6334:6334 -v /var/lib/qdrant/storage:/qdrant/storage:z qdrant/qdrant:$QDRANT_VERSION"

  log "Qdrant ready at http://$ip:6333"
}

# ─── Create Neo4j VM ──────────────────────────────────────────

setup_neo4j() {
  log "=== Setting up Neo4j Knowledge Graph (VMID $NEO4J_VMID) ==="

  if vm_exists "$NEO4J_VMID"; then
    log "VM $NEO4J_VMID already exists — skipping creation"
  else
    log "Cloning template $TEMPLATE_ID → VM $NEO4J_VMID"
    qm clone "$TEMPLATE_ID" "$NEO4J_VMID" \
      --name "openclaw-neo4j" \
      --full true \
      --storage "$STORAGE"

    qm set "$NEO4J_VMID" \
      --cores "$NEO4J_CORES" \
      --memory "$NEO4J_MEM" \
      --net0 "virtio,bridge=$BRIDGE" \
      --ipconfig0 "ip=$NEO4J_IP,gw=$NEO4J_GW" \
      --sshkeys "$SSH_KEY" \
      --onboot 1 \
      --description "OpenClaw Neo4j Graph DB — ports 7474, 7687"

    qm resize "$NEO4J_VMID" scsi0 "$NEO4J_DISK"

    log "Starting VM $NEO4J_VMID"
    qm start "$NEO4J_VMID"
  fi

  local ip="${NEO4J_IP%%/*}"
  wait_for_ssh "$NEO4J_IP"

  log "Installing Neo4j via Docker..."
  ssh -o StrictHostKeyChecking=no "root@$ip" bash -s <<NEOSETUP
set -euo pipefail

# Install Docker if not present
if ! command -v docker &>/dev/null; then
  apt-get update -qq
  apt-get install -y -qq docker.io
  systemctl enable --now docker
fi

# Create persistent storage
mkdir -p /var/lib/neo4j/data
mkdir -p /var/lib/neo4j/logs

# Stop existing container
docker stop neo4j 2>/dev/null || true
docker rm neo4j 2>/dev/null || true

# Run Neo4j Community Edition
# Accept license, disable auth for initial setup, set memory limits
docker run -d \
  --name neo4j \
  --restart unless-stopped \
  -p 7474:7474 \
  -p 7687:7687 \
  -v /var/lib/neo4j/data:/data:z \
  -v /var/lib/neo4j/logs:/logs:z \
  -e NEO4J_AUTH=neo4j/openclaw-graph \
  -e NEO4J_server_memory_heap_initial__size=1g \
  -e NEO4J_server_memory_heap_max__size=2g \
  -e NEO4J_server_memory_pagecache_size=2g \
  -e NEO4J_dbms_security_procedures_unrestricted=apoc.* \
  neo4j:$NEO4J_VERSION

# Wait for Neo4j to be ready
for i in \$(seq 1 60); do
  if curl -sf http://localhost:7474/ >/dev/null 2>&1; then
    echo "Neo4j is ready"
    break
  fi
  sleep 3
done
NEOSETUP

  log "Neo4j ready at http://$ip:7474 (user: neo4j, pass: openclaw-graph)"
}

# ─── Create MariaDB VM ────────────────────────────────────────

setup_mariadb() {
  log "=== Setting up MariaDB Relational Database (VMID $MARIADB_VMID) ==="

  if vm_exists "$MARIADB_VMID"; then
    log "VM $MARIADB_VMID already exists — skipping creation"
  else
    log "Cloning template $TEMPLATE_ID → VM $MARIADB_VMID"
    qm clone "$TEMPLATE_ID" "$MARIADB_VMID" \
      --name "openclaw-mariadb" \
      --full true \
      --storage "$STORAGE"

    qm set "$MARIADB_VMID" \
      --cores "$MARIADB_CORES" \
      --memory "$MARIADB_MEM" \
      --net0 "virtio,bridge=$BRIDGE" \
      --ipconfig0 "ip=$MARIADB_IP,gw=$MARIADB_GW" \
      --sshkeys "$SSH_KEY" \
      --onboot 1 \
      --description "OpenClaw MariaDB — port 3306"

    qm resize "$MARIADB_VMID" scsi0 "$MARIADB_DISK"

    log "Starting VM $MARIADB_VMID"
    qm start "$MARIADB_VMID"
  fi

  local ip="${MARIADB_IP%%/*}"
  wait_for_ssh "$MARIADB_IP"

  log "Installing MariaDB via Docker..."
  ssh -o StrictHostKeyChecking=no "root@$ip" bash -s <<MARIASETUP
set -euo pipefail

# Install Docker if not present
if ! command -v docker &>/dev/null; then
  apt-get update -qq
  apt-get install -y -qq docker.io
  systemctl enable --now docker
fi

# Create persistent storage
mkdir -p /var/lib/mysql

# Stop existing container
docker stop mariadb 2>/dev/null || true
docker rm mariadb 2>/dev/null || true

# Run MariaDB
docker run -d \
  --name mariadb \
  --restart unless-stopped \
  -p 3306:3306 \
  -v /var/lib/mysql:/var/lib/mysql:z \
  -e MARIADB_ROOT_PASSWORD=openclaw-root \
  -e MARIADB_DATABASE=openclaw \
  -e MARIADB_USER=openclaw \
  -e MARIADB_PASSWORD=openclaw-sql \
  mariadb:$MARIADB_VERSION

# Wait for MariaDB to be ready
for i in \$(seq 1 60); do
  if docker exec mariadb healthcheck.sh --connect --innodb_initialized 2>/dev/null; then
    echo "MariaDB is ready"
    break
  fi
  sleep 3
done
MARIASETUP

  log "MariaDB ready at $ip:3306 (user: openclaw, pass: openclaw-sql, db: openclaw)"
}

# ─── Main ─────────────────────────────────────────────────────

main() {
  log "OpenClaw Database VM Setup"
  log "=========================="

  case "${1:-all}" in
    --qdrant-only)  setup_qdrant ;;
    --neo4j-only)   setup_neo4j ;;
    --mariadb-only) setup_mariadb ;;
    all|*)
      setup_qdrant
      setup_neo4j
      setup_mariadb
      ;;
  esac

  log ""
  log "Done! Add to your openclaw.json:"
  log ""
  log '  "databases": {'
  log '    "qdrant": { "url": "http://10.0.0.50:6333", "collection": "openclaw" },'
  log '    "neo4j": { "url": "http://10.0.0.51:7474", "username": "neo4j", "password": "openclaw-graph" },'
  log '    "sql": { "backend": "mariadb", "url": "http://10.0.0.52:3306", "username": "openclaw", "password": "openclaw-sql" }'
  log '  }'
}

main "$@"
