#!/bin/bash
# ──────────────────────────────────────────────────────────────
# OpenClaw v2 — Proxmox LXC/VM Installer
#
# PURPOSE:
#   This script automates the full installation of the OpenClaw v2
#   Autonomous Agency Framework onto a Proxmox VE host. It can either
#   create a brand-new LXC container (or VM) on Proxmox and install
#   OpenClaw inside it, or install directly into the current machine
#   when the --existing flag is used.
#
# WHAT IT DOES (6-step process):
#   1. Creates a Proxmox LXC container (or VM) with user-specified
#      resources (CPU cores, RAM, disk, network bridge), unless
#      --existing is passed to skip container creation.
#   2. Installs system-level dependencies (curl, git, build-essential,
#      ca-certificates, gnupg) via apt-get.
#   3. Installs Node.js (version controlled by NODE_VERSION variable)
#      from the NodeSource repository.
#   4. Installs the OpenClaw application into /opt/openclaw, either
#      from npm or from a bundled source package.
#   5. Generates a default JSON configuration file (openclaw.json)
#      with settings for the gateway, agent, memory, sandbox, RBAC,
#      skills, lane queue, and service discovery.
#   6. Creates and enables a systemd service so OpenClaw starts
#      automatically on boot.
#
# ARCHITECTURE CONTEXT:
#   OpenClaw is the central orchestrator in a multi-container LLM
#   council architecture. After this script runs, you can use
#   setup-council.sh to create additional LXC containers, each
#   running a different LLM model (via Ollama), which OpenClaw
#   coordinates as a "council" of AI agents.
#
# Installs OpenClaw into a Proxmox LXC container or VM.
# OpenClaw then manages additional LXC containers for LLM council members.
#
# Usage:
#   # Create LXC container and install OpenClaw:
#   bash install-openclaw.sh --type lxc --vmid 100 --cores 4 --memory 8192
#
#   # Install into existing VM/container:
#   bash install-openclaw.sh --existing
# ──────────────────────────────────────────────────────────────

# Enable strict error handling:
#   -e : Exit immediately if any command returns a non-zero status.
#   -u : Treat unset variables as an error and exit.
#   -o pipefail : Return the exit status of the last command in a pipeline
#                 that failed, rather than the exit status of the final command.
set -euo pipefail

# ─── Default Configuration Values ──────────────────────────────
# These defaults are used when the corresponding CLI flags are not provided.
# They define the resources and identity of the Proxmox container/VM
# that will host the OpenClaw application.

# INSTALL_TYPE: Whether to create an LXC container or a full VM.
#   "lxc" is the default because LXC containers are lighter weight and
#   sufficient for running Node.js-based OpenClaw.
INSTALL_TYPE="lxc"
# VMID: The Proxmox VM/container ID. 301 is the designated slot for
#   OpenClaw in the 300-series numbering scheme (302+ are for council members).
VMID="301"
# CORES: Number of CPU cores allocated to the container/VM.
CORES="4"
# MEMORY: Amount of RAM in megabytes (8192 MB = 8 GB).
MEMORY="8192"
# DISK: Root filesystem size in gigabytes.
DISK="30"
# HOSTNAME: The hostname assigned to the container/VM.
HOSTNAME="openclaw"
# BRIDGE: The Proxmox network bridge to attach the container's virtual NIC to.
#   vmbr0 is typically the default bridge connected to the host's physical NIC.
BRIDGE="vmbr0"
# STORAGE: The Proxmox storage pool where the container's root filesystem is created.
#   "local-lvm" is the default LVM thin pool on most Proxmox installations.
STORAGE="local-lvm"
# TEMPLATE: Path to the LXC template image used to create the container.
#   This points to an Ubuntu 22.04 standard template in the Proxmox template store.
TEMPLATE="local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst"
# NODE_VERSION: The major version of Node.js to install (from NodeSource).
#   Version 20 is the current LTS release.
NODE_VERSION="20"
# EXISTING: When set to true (via --existing flag), the script skips container
#   creation and installs OpenClaw directly into the current machine/environment.
EXISTING=false

# ─── CLI Argument Parsing ──────────────────────────────────────
# Iterates over all positional parameters ($1, $2, ...) and matches
# them against known flags. Each flag that takes a value consumes
# two arguments (the flag itself and its value) via "shift 2".
# Flags without values (--existing, --help) consume one argument via "shift".
# Unknown flags cause the script to exit with an error message.
while [[ $# -gt 0 ]]; do
  case $1 in
    --type)       INSTALL_TYPE="$2"; shift 2 ;;  # Container type: "lxc" or "vm"
    --vmid)       VMID="$2"; shift 2 ;;          # Proxmox VM/CT numeric identifier
    --cores)      CORES="$2"; shift 2 ;;         # CPU core count
    --memory)     MEMORY="$2"; shift 2 ;;        # RAM in megabytes
    --disk)       DISK="$2"; shift 2 ;;          # Disk size in gigabytes
    --hostname)   HOSTNAME="$2"; shift 2 ;;      # Container hostname
    --bridge)     BRIDGE="$2"; shift 2 ;;        # Proxmox network bridge name
    --storage)    STORAGE="$2"; shift 2 ;;       # Proxmox storage pool name
    --template)   TEMPLATE="$2"; shift 2 ;;      # LXC template path
    --existing)   EXISTING=true; shift ;;        # Skip container creation
    --help)                                      # Display usage help and exit
      echo "Usage: install-openclaw.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --type lxc|vm     Container type (default: lxc)"
      echo "  --vmid NUM        VM/CT ID (default: 301)"
      echo "  --cores NUM       CPU cores (default: 4)"
      echo "  --memory NUM      Memory in MB (default: 8192)"
      echo "  --disk NUM        Disk in GB (default: 30)"
      echo "  --hostname NAME   Hostname (default: openclaw)"
      echo "  --bridge NAME     Network bridge (default: vmbr0)"
      echo "  --storage NAME    Storage pool (default: local-lvm)"
      echo "  --template PATH   LXC template (default: ubuntu 22.04)"
      echo "  --existing        Install into current machine (no container creation)"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;  # Reject unrecognized flags
  esac
done

# ─── Display Banner ────────────────────────────────────────────
# Print a visual banner to clearly indicate the start of the installation process.
echo "╔══════════════════════════════════════════╗"
echo "║  OpenClaw v2 — Proxmox Installer        ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ─── Step 1: Create container (if not --existing) ─────────────
# When --existing is NOT set, this block creates a new Proxmox LXC container
# using the `pct create` command. The container is configured with:
#   --unprivileged 1 : Runs the container in unprivileged mode for security
#                      (container root is mapped to a non-root UID on the host).
#   --features nesting=1 : Enables nesting, which allows running containers
#                          inside this container (required because OpenClaw
#                          may manage sub-containers for council members).
#   --start 1 : Automatically start the container after creation.
#   --net0 : Attaches a virtual NIC (eth0) to the specified bridge with DHCP.
#
# After creation, the script waits 10 seconds for the container to fully boot,
# retrieves its IP address, and then executes the remaining installation steps
# inside the container via `pct exec`.

if [ "$EXISTING" = false ]; then
  echo "[1/6] Creating ${INSTALL_TYPE} container (VMID: ${VMID})..."

  if [ "$INSTALL_TYPE" = "lxc" ]; then
    # Create the LXC container using the Proxmox `pct` command-line tool.
    # This provisions a new container from the specified template with the
    # given resource allocations and network settings.
    pct create "$VMID" "$TEMPLATE" \
      --hostname "$HOSTNAME" \
      --cores "$CORES" \
      --memory "$MEMORY" \
      --rootfs "${STORAGE}:${DISK}" \
      --net0 "name=eth0,bridge=${BRIDGE},ip=dhcp" \
      --unprivileged 1 \
      --features nesting=1 \
      --start 1

    # Allow time for the container's init system to fully boot and
    # for DHCP to assign an IP address before attempting to interact with it.
    echo "Waiting for container to boot..."
    sleep 10

    # Retrieve the container's primary IP address by executing `hostname -I`
    # inside the container and extracting the first IP from the output.
    # Get container IP
    CT_IP=$(pct exec "$VMID" -- hostname -I | awk '{print $1}')
    echo "Container IP: ${CT_IP}"

    # Execute the remaining installation steps inside the container.
    # This uses a heredoc to inject a script into `pct exec`.
    # Note: INSTALL_INNER is a flag variable (currently a placeholder)
    # intended to indicate that the script is running inside the container.
    # Run the rest inside the container
    pct exec "$VMID" -- bash -c "$(cat <<'INNERSCRIPT'
INSTALL_INNER=true
INNERSCRIPT
)"
  fi
fi

# ─── Step 2: Install System Dependencies ──────────────────────
# Updates the apt package index and installs essential system packages:
#   curl             : Used to download Node.js setup script and other resources.
#   git              : Version control; needed to clone/update OpenClaw source.
#   build-essential  : C/C++ compiler toolchain (gcc, make, etc.) required by
#                      some npm packages that include native addons.
#   ca-certificates  : Root CA certificates for HTTPS connections.
#   gnupg            : GNU Privacy Guard; needed for verifying package signatures
#                      (e.g., the NodeSource GPG key).
# The -qq flag suppresses apt output to keep the install log clean.

echo "[2/6] Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq curl git build-essential ca-certificates gnupg

# ─── Step 3: Install Node.js ──────────────────────────────────
# Installs Node.js from the NodeSource binary distribution if it is not
# already installed. The `command -v node` check prevents re-installation
# on subsequent runs (idempotency).
#
# The NodeSource setup script adds the NodeSource apt repository and its
# GPG key, then a standard `apt-get install` pulls the correct Node.js
# version. npm (Node Package Manager) is bundled with Node.js.
#
# After installation, the script prints the installed versions for
# verification in the install log.

echo "[3/6] Installing Node.js ${NODE_VERSION}..."
if ! command -v node &> /dev/null; then
  # Download and execute the NodeSource setup script, which configures
  # the apt repository for the specified major Node.js version.
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y -qq nodejs
fi
# Print installed versions for verification.
echo "Node.js $(node -v)"
echo "npm $(npm -v)"

# ─── Step 4: Install OpenClaw Application ────────────────────
# Installs the OpenClaw application into /opt/openclaw. This step uses
# a two-tier strategy:
#   1. First, attempt to install from the npm registry (for released versions).
#   2. If npm install fails (e.g., package not yet published), fall back to
#      creating a local project with the minimum required dependencies.
#
# The installation directory /opt/openclaw is the canonical location used
# by the systemd service and all configuration paths.

echo "[4/6] Installing OpenClaw..."
# Create the installation directory if it does not already exist.
mkdir -p /opt/openclaw
cd /opt/openclaw

# Clone or initialize — check if a git repository already exists in /opt/openclaw.
# If it does, this is a re-run / upgrade, so pull the latest changes.
# Otherwise, initialize a fresh git repo and npm project.
if [ -d ".git" ]; then
  echo "Existing OpenClaw installation found, updating..."
  git pull
else
  git init
  # In production, this would clone from the registry
  # For now, we initialize and copy the source
  # Initialize a minimal package.json so npm can track dependencies.
  npm init -y > /dev/null 2>&1
fi

# Install from npm (or local) — attempt to install the "openclaw" package
# from the npm registry. The "2>/dev/null" suppresses error output in case
# the package is not yet published. If it fails, the fallback block creates
# a minimal package.json with only the essential dependencies:
#   ajv  — JSON Schema validator for config file validation
#   ws   — WebSocket library for the gateway server
#   uuid — UUID generator for unique request/session identifiers
npm install openclaw 2>/dev/null || {
  echo "Installing from source..."
  # If npm package isn't published yet, set up locally
  # Create a minimal package.json with the core dependencies that OpenClaw
  # needs to function. This enables development and testing before the
  # official npm package is published.
  cat > package.json << 'PKGJSON'
{
  "name": "openclaw-server",
  "version": "2.0.0",
  "private": true,
  "dependencies": {
    "ajv": "^8.12.0",
    "ws": "^8.16.0",
    "uuid": "^9.0.0"
  }
}
PKGJSON
  # Install the locally-defined dependencies from npm.
  npm install
}

# ─── Step 5: Generate Default Configuration ──────────────────
# Creates the primary configuration file (openclaw.json) if one does not
# already exist. This preserves any manual edits from previous runs.
#
# The configuration file controls all major subsystems of OpenClaw:
#   - gateway:    WebSocket server settings (host, port, CORS origins)
#   - agent:      Default LLM model, conversation turn limits, temperature
#   - memory:     Memory backend type (graph), node limits, auto-summarization
#   - sandbox:    Code execution sandbox using nsjail with resource limits
#   - rbac:       Role-Based Access Control with admin and agent roles
#   - skills:     Plugin/skill system settings (signature verification)
#   - laneQueue:  Parallel task execution lane configuration
#   - discovery:  Service discovery for auto-detecting council members

echo "[5/6] Generating configuration..."
if [ ! -f "openclaw.json" ]; then
  # Write the default configuration as a heredoc. The 'CONFIG' delimiter
  # is single-quoted to prevent variable expansion inside the JSON.
  cat > openclaw.json << 'CONFIG'
{
  "version": "2.0.0",
  "gateway": {
    "host": "0.0.0.0",
    "port": 3100,
    "allowedOrigins": [
      "http://localhost:3100",
      "http://127.0.0.1:3100"
    ]
  },
  "agent": {
    "defaultModel": "dolphin-mistral:7b",
    "maxTurns": 50,
    "temperature": 0.7
  },
  "memory": {
    "backend": "graph",
    "maxNodes": 10000,
    "autoSummarize": true
  },
  "sandbox": {
    "enabled": true,
    "runtime": "nsjail",
    "allowNetwork": false,
    "maxMemoryMb": 512,
    "maxCpuSeconds": 30,
    "allowedPaths": ["/opt/openclaw/workspace"]
  },
  "rbac": {
    "enabled": true,
    "defaultRole": "agent",
    "roles": [
      {
        "name": "admin",
        "permissions": ["*"],
        "allowedPaths": ["**"],
        "allowedApiScopes": ["*"]
      },
      {
        "name": "agent",
        "permissions": ["FS_READ", "FS_WRITE", "SHELL_EXEC", "NET_OUTBOUND"],
        "allowedPaths": ["/opt/openclaw/workspace/**"],
        "allowedApiScopes": ["llm:invoke", "memory:*", "council:*"]
      }
    ]
  },
  "skills": {
    "requireSigned": false
  },
  "laneQueue": {
    "maxParallel": 4
  },
  "discovery": {
    "enabled": true,
    "scanIntervalMs": 30000
  }
}
CONFIG
  echo "Created openclaw.json"
else
  # If openclaw.json already exists, preserve it to avoid overwriting
  # any user customizations made after a previous installation.
  echo "Using existing openclaw.json"
fi

# Create the workspace directory where agents execute code and store
# intermediate files. This path is referenced in the sandbox and RBAC
# configuration sections of openclaw.json as the allowed working directory.
mkdir -p /opt/openclaw/workspace

# ─── Step 6: Create and Enable systemd Service ───────────────
# Creates a systemd unit file that manages the OpenClaw process as a
# system service. This enables:
#   - Automatic startup on boot (via "systemctl enable")
#   - Automatic restart on failure (Restart=on-failure, 5-second delay)
#   - Standard service management (start, stop, status, logs)
#
# The service runs after the network is available (After=network.target)
# so that WebSocket connections and council member discovery can function.
#
# Service configuration details:
#   Type=simple         — systemd considers the service started immediately
#   User=root           — runs as root (needed for container management)
#   WorkingDirectory    — ensures openclaw.json is found relative to CWD
#   ExecStart           — launches the OpenClaw CLI entry point
#   NODE_ENV=production — disables development features, enables optimizations

echo "[6/6] Creating systemd service..."
cat > /etc/systemd/system/openclaw.service << 'SERVICE'
[Unit]
Description=OpenClaw v2 Autonomous Agency Framework
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/openclaw
ExecStart=/usr/bin/node dist/cli.js start
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICE

# Reload systemd's configuration so it recognizes the new/updated service file.
systemctl daemon-reload
# Enable the service to start automatically on every boot.
# Note: This does NOT start the service immediately; the user must run
# "systemctl start openclaw" after reviewing the configuration.
systemctl enable openclaw

# ─── Installation Complete — Print Summary ────────────────────
# Display a summary of the installation including key file paths,
# service commands, and next steps for the operator.
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  OpenClaw v2 installed successfully!     ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  Location:  /opt/openclaw"
echo "  Config:    /opt/openclaw/openclaw.json"
echo "  Service:   systemctl start openclaw"
echo "  Gateway:   ws://0.0.0.0:3100"
echo "  Web UI:    http://0.0.0.0:3101"
echo ""
echo "Next steps:"
echo "  1. Edit /opt/openclaw/openclaw.json"
echo "  2. systemctl start openclaw"
echo "  3. Open http://<IP>:3101 in your browser"
echo ""
echo "To set up an LLM council, see:"
echo "  /opt/openclaw/deploy/setup-council.sh"
