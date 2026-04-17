#!/bin/bash
# ──────────────────────────────────────────────────────────────
# OpenClaw v2 — 3-Tier LLM Council Setup
#
# PURPOSE:
#   This script provisions a hierarchical "council" of LLM (Large Language
#   Model) instances running on Proxmox VE. Each council member runs in
#   its own Proxmox container (LXC) or virtual machine (VM), hosting a
#   specific LLM model served by Ollama. OpenClaw orchestrates these
#   council members to collaboratively solve complex tasks.
#
# 3-TIER ARCHITECTURE:
#   The council follows a tree-shaped hierarchy:
#
#   Tier 1 (Director): A single VM running the largest, most capable model
#     (e.g., Dolphin Mixtral 8x7B). It decomposes tasks and synthesizes
#     final answers from branch outputs. Runs as a full VM because large
#     models may benefit from direct hardware access.
#
#   Tier 2 (Branch Coordinators): LXC containers each running a mid-sized
#     model. Two branches exist — "logical" (analytical reasoning) and
#     "creative" (brainstorming, writing). Coordinators delegate sub-tasks
#     to their Tier 3 specialists.
#
#   Tier 3 (Specialists): LXC containers running smaller, task-specific
#     models (coders, reviewers, mathematicians, writers). These are the
#     "leaf nodes" that produce the bulk of the work product.
#
# RESOURCE SIZING:
#   Container memory is auto-sized from model parameters using Q4_K_M
#   quantization estimates:
#     RAM  = (params_B x 0.6 GB) + 1.5 GB overhead, rounded to 512 MB
#     Cores: 2 for <=2B, 4 for <=8B, 6 for <=15B, 8 for <=35B, 12 for 35B+
#     Disk = (params_B x 0.55 GB) + 5 GB
#
# Creates a hierarchical council on Proxmox:
#   Tier 1 (Director): VM with the largest model
#   Tier 2 (Branches): LXC containers for logical + creative coordinators
#   Tier 3 (Specialists): LXC containers for purpose-specific small LLMs
#
# Container memory is auto-sized from model parameters:
#   RAM ≈ (params_B × 0.6 GB) + 1.5 GB overhead (Q4_K_M)
#
# Prerequisites:
#   - Proxmox VE host with API access
#   - Ubuntu 22.04 LXC template + ISO for VMs
#   - Sufficient resources (see --help for estimates)
#
# Usage:
#   bash setup-council.sh                     # 16 cores, 80% of 256GB RAM
#   bash setup-council.sh --base-vmid 302     # Custom starting VMID
# ──────────────────────────────────────────────────────────────

# Enable strict error handling: exit on error (-e), treat unset variables
# as errors (-u), and propagate pipeline failures (-o pipefail).
set -euo pipefail

# ─── Default Configuration Values ─────────────────────────────
# These defaults define the Proxmox infrastructure parameters used when
# creating council member containers and VMs.

# PRESET: The council configuration preset to use. Determines which models
#   and how many council members are created. Currently only "openclaw" is
#   available, which creates an 8-member council for a 256GB Threadripper system.
PRESET="openclaw"
# BASE_VMID: The starting Proxmox VM/container ID for council members.
#   VMID 301 is reserved for OpenClaw itself (see install-openclaw.sh).
#   Council members are numbered sequentially: 302 (Director), 303, 304, etc.
BASE_VMID=302
# BRIDGE: The Proxmox network bridge for container NICs. vmbr0 is the
#   default bridge connected to the physical network.
BRIDGE="vmbr0"
# STORAGE: The Proxmox storage pool for container/VM root filesystems.
STORAGE="local-lvm"
# TEMPLATE: Path to the Ubuntu 22.04 LXC template used for Tier 2/3 containers.
TEMPLATE="local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst"
# ISO_STORAGE: The Proxmox storage pool where ISO images are stored.
#   Used for the Tier 1 Director VM which boots from an ISO.
ISO_STORAGE="local"
# ISO_IMAGE: The Ubuntu Server ISO filename for creating the Director VM.
ISO_IMAGE="ubuntu-22.04.3-live-server-amd64.iso"
# MAX_RESOURCE_PCT: Safety limit — the maximum percentage of host CPU and
#   RAM that the council is allowed to consume. Prevents over-provisioning
#   and leaves headroom for the Proxmox host OS and other services.
MAX_RESOURCE_PCT=80  # Use up to 80% of host resources

# ─── CLI Argument Parsing ─────────────────────────────────────
# Parse command-line flags to override default configuration values.
# Each flag that takes a value consumes two arguments (flag + value).
while [[ $# -gt 0 ]]; do
  case $1 in
    --preset)       PRESET="$2"; shift 2 ;;       # Council preset name
    --base-vmid)    BASE_VMID="$2"; shift 2 ;;    # Starting VMID for council members
    --bridge)       BRIDGE="$2"; shift 2 ;;        # Proxmox network bridge
    --storage)      STORAGE="$2"; shift 2 ;;       # Proxmox storage pool
    --max-pct)      MAX_RESOURCE_PCT="$2"; shift 2 ;; # Max % of host resources
    --help)
      echo "Usage: setup-council.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --preset NAME     Council preset: openclaw"
      echo "  --base-vmid NUM   Starting VMID (default: 302)"
      echo "  --bridge NAME     Network bridge (default: vmbr0)"
      echo "  --storage NAME    Storage pool (default: local-lvm)"
      echo "  --max-pct NUM     Max % of host resources to use (default: 80)"
      echo ""
      echo "3-Tier Architecture:"
      echo "  Tier 1 (Director VM):   Largest model, orchestrates everything"
      echo "  Tier 2 (Branch LXC):    Logical + Creative branch coordinators"
      echo "  Tier 3 (Specialist LXC): Small purpose-specific models"
      echo ""
      echo "Preset resource estimates (auto-sized from model params):"
      echo "  openclaw: 8 containers, ~106 GB RAM, 16 cores (256GB Threadripper)"
      echo ""
      echo "VMID numbering (300 series):"
      echo "  301 = OpenClaw (install-openclaw.sh)"
      echo "  302 = Director VM (Tier 1)"
      echo "  303+ = Council members (Tier 2/3 LXC)"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;  # Reject unrecognized flags
  esac
done

# ─── Display Banner ───────────────────────────────────────────
# Print a visual banner showing the 3-tier architecture being set up.
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  OpenClaw v2 — 3-Tier LLM Council Setup                ║"
echo "║  Director (VM) → Branches (LXC) → Specialists (LXC)   ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ─── Model-to-Resource Calculator Functions ───────────────────
# These functions convert a model's parameter count (in billions) into
# the hardware resources needed to run it. The formulas assume Q4_K_M
# quantization, which uses approximately 0.6 GB per billion parameters.
#
# RAM: (params × 0.6 GB) + 1.5 GB overhead, rounded to 512MB
# Cores: 2 for ≤2B, 4 for ≤8B, 6 for ≤15B, 8 for ≤35B, 12 for 35B+
# Disk: (params × 0.55 GB) + 5 GB

# calc_memory: Calculate required RAM in megabytes for a given model size.
#   Formula: (params_in_billions * 0.6 GB) + 1.5 GB overhead
#   The 0.6 GB/B factor accounts for Q4_K_M quantized model weights in memory.
#   The 1.5 GB overhead covers the Ollama runtime, OS, and inference buffers.
#   Result is rounded up to the nearest 512 MB for Proxmox alignment.
#   Args: $1 = model parameter count in billions (e.g., 7, 34, 47)
#   Returns: RAM in MB (e.g., 5632 for a 7B model)
calc_memory() {
  local params="$1"
  # Calculate raw RAM needed in GB using bc for floating-point arithmetic.
  local ram_gb=$(echo "$params * 0.6 + 1.5" | bc)
  # Convert GB to MB and truncate to integer.
  local ram_mb=$(echo "$ram_gb * 1024" | bc | cut -d. -f1)
  # Round up to nearest 512 MB boundary for clean Proxmox resource allocation.
  echo $(( (ram_mb + 511) / 512 * 512 ))
}

# calc_cores: Determine CPU core count based on model size.
#   Larger models need more cores for parallel matrix operations during inference.
#   The tier thresholds are empirically chosen for good performance on consumer
#   and workstation CPUs.
#   Args: $1 = model parameter count in billions
#   Returns: Number of CPU cores (2, 4, 6, 8, or 12)
calc_cores() {
  local params="$1"
  # Truncate to integer for comparison (handles fractional params like 2.7).
  local p=$(echo "$params" | cut -d. -f1)
  if [ "$p" -le 2 ]; then echo 2       # Tiny models (TinyLlama, Phi-2)
  elif [ "$p" -le 8 ]; then echo 4     # Small models (Mistral 7B, Llama 8B)
  elif [ "$p" -le 15 ]; then echo 6    # Medium models (Solar 10.7B)
  elif [ "$p" -le 35 ]; then echo 8    # Large models (CodeLlama 34B)
  else echo 12                          # Extra-large models (Mixtral 47B)
  fi
}

# calc_disk: Calculate required disk space in gigabytes for a given model.
#   Formula: (params_in_billions * 0.55 GB) + 5 GB
#   The 0.55 GB/B factor is the on-disk size of Q4_K_M quantized weights.
#   The 5 GB overhead covers the OS, Ollama binaries, and temporary files.
#   Args: $1 = model parameter count in billions
#   Returns: Disk size in GB (e.g., 9 for a 7B model)
calc_disk() {
  local params="$1"
  echo $(echo "$params * 0.55 + 5" | bc | cut -d. -f1)
}

# ─── Define Council Members by Preset ─────────────────────────
# Each preset defines a complete council configuration: the list of members,
# their models, tier assignments, branch affiliations, and roles.
#
# The members are stored in parallel arrays — each index i represents one
# council member, and the arrays share the same index:
#   NAMES[i]        — short name for the member (used in hostname and config)
#   MODELS[i]       — the Ollama model tag to pull and serve
#   PARAMS[i]       — model parameter count in billions (for resource sizing)
#   TIERS[i]        — hierarchy tier: 1=Director, 2=Coordinator, 3=Specialist
#   BRANCHES[i]     — branch affiliation: "logical", "creative", or "-" (none)
#   TYPES[i]        — Proxmox type: "vm" for full VM, "lxc" for container
#   ROLES[i]        — functional role name (director, coder, reviewer, etc.)
#   SPECIALITIES[i] — human-readable description of the member's specialty
#   FORCED_CORES[i] — override for auto-calculated core count (0 = use auto)
#
# Arrays: NAME MODEL PARAMS TIER BRANCH TYPE
# TYPE: vm = Proxmox VM, lxc = Proxmox LXC container

declare -a NAMES MODELS PARAMS TIERS BRANCHES TYPES ROLES SPECIALITIES

case "$PRESET" in
  openclaw|homelab)
    # ── "openclaw" Preset ──────────────────────────────────────
    # Designed for a homelab with a 256 GB RAM Threadripper system.
    # Budget: 16 cores, 80% of 256GB RAM (~204GB)
    # Creates 8 council members across 3 tiers:
    #   1 Director (VM), 2 Branch Coordinators (LXC), 5 Specialists (LXC)
    #
    # VMID Allocation:
    #   302 = Director (Tier 1, VM)
    #   303 = Logical Lead (Tier 2, LXC)
    #   304 = Coder (Tier 3, LXC)
    #   305 = Reviewer (Tier 3, LXC)
    #   306 = Logician (Tier 3, LXC)
    #   307 = Creative Lead (Tier 2, LXC)
    #   308 = Brainstormer (Tier 3, LXC)
    #   309 = Writer (Tier 3, LXC)

    # VMID 302: Tier 1 Director (VM) — Dolphin Mixtral 8x7B (4 cores)
    # The Director is the top of the hierarchy. It receives tasks from
    # OpenClaw, decomposes them into sub-tasks, delegates to branch
    # coordinators, and synthesizes their outputs into a final answer.
    # Runs as a full VM (not LXC) because the large Mixtral MoE model
    # benefits from direct hardware access.
    NAMES=("director")
    MODELS=("dolphin-mixtral:8x7b-v2.6")
    PARAMS=(47)
    TIERS=(1)
    BRANCHES=("-")
    TYPES=("vm")
    ROLES=("director")
    SPECIALITIES=("Task decomposition and synthesis")
    FORCED_CORES=(4)  # Override: 4 cores instead of auto-calculated 12

    # VMID 303: Tier 2 Logical Branch Coordinator (3 cores)
    # Leads the "logical" branch. Receives analytical sub-tasks from the
    # Director and delegates them to specialist members (coder, reviewer,
    # logician). Synthesizes specialist outputs into a coherent branch response.
    NAMES+=("logical-lead")
    MODELS+=("nous-hermes2:34b")
    PARAMS+=(34)
    TIERS+=(2)
    BRANCHES+=("logical")
    TYPES+=("lxc")
    ROLES+=("logical")
    SPECIALITIES+=("Analytical reasoning")
    FORCED_CORES+=(3)  # Override: 3 cores instead of auto-calculated 8

    # VMID 304: Tier 3 Coder Specialist (2 cores)
    # Generates code solutions. Belongs to the "logical" branch and
    # receives coding tasks from the logical-lead coordinator.
    # Uses CodeBooga 34B, a code-specialized model.
    NAMES+=("coder")
    MODELS+=("codebooga:34b")
    PARAMS+=(34)
    TIERS+=(3)
    BRANCHES+=("logical")
    TYPES+=("lxc")
    ROLES+=("coder")
    SPECIALITIES+=("Code generation")
    FORCED_CORES+=(2)  # Override: 2 cores to conserve resources

    # VMID 305: Tier 3 Code Reviewer Specialist (2 cores)
    # Reviews code produced by the coder for correctness, security,
    # and best practices. Uses the smaller Dolphin Mistral 7B model,
    # which is sufficient for review tasks.
    NAMES+=("reviewer")
    MODELS+=("dolphin-mistral:7b")
    PARAMS+=(7)
    TIERS+=(3)
    BRANCHES+=("logical")
    TYPES+=("lxc")
    ROLES+=("reviewer")
    SPECIALITIES+=("Code review")
    FORCED_CORES+=(2)

    # VMID 306: Tier 3 Logician/Mathematician Specialist (1 core)
    # Handles mathematical reasoning and formal logic tasks.
    # Uses the tiny Dolphin Phi 2.7B model — small but capable for
    # structured mathematical reasoning. Only needs 1 core.
    NAMES+=("logician")
    MODELS+=("dolphin-phi:2.7b")
    PARAMS+=(2.7)
    TIERS+=(3)
    BRANCHES+=("logical")
    TYPES+=("lxc")
    ROLES+=("mathematician")
    SPECIALITIES+=("Math and formal logic")
    FORCED_CORES+=(1)

    # VMID 307: Tier 2 Creative Branch Coordinator (2 cores)
    # Leads the "creative" branch. Receives creative/writing sub-tasks
    # from the Director and delegates them to the brainstormer and writer
    # specialists. Synthesizes their outputs into a coherent creative response.
    NAMES+=("creative-lead")
    MODELS+=("nous-hermes2:10.7b")
    PARAMS+=(10.7)
    TIERS+=(2)
    BRANCHES+=("creative")
    TYPES+=("lxc")
    ROLES+=("creative")
    SPECIALITIES+=("Creative synthesis")
    FORCED_CORES+=(2)

    # VMID 308: Tier 3 Brainstormer Specialist (1 core)
    # Generates diverse ideas and creative approaches. Belongs to the
    # "creative" branch. Uses OpenHermes 7B, which excels at open-ended
    # idea generation.
    NAMES+=("brainstormer")
    MODELS+=("openhermes:7b")
    PARAMS+=(7)
    TIERS+=(3)
    BRANCHES+=("creative")
    TYPES+=("lxc")
    ROLES+=("brainstormer")
    SPECIALITIES+=("Brainstorming")
    FORCED_CORES+=(1)

    # VMID 309: Tier 3 Writer/Documentation Specialist (1 core)
    # Produces polished written content and documentation. Belongs to
    # the "creative" branch. Uses Dolphin Llama3 8B for high-quality
    # natural language output.
    NAMES+=("writer")
    MODELS+=("dolphin-llama3:8b")
    PARAMS+=(8)
    TIERS+=(3)
    BRANCHES+=("creative")
    TYPES+=("lxc")
    ROLES+=("writer")
    SPECIALITIES+=("Writing and documentation")
    FORCED_CORES+=(1)
    ;;

  *)
    # Unknown preset — display available presets and exit.
    echo "Unknown preset: $PRESET"
    echo "Available: openclaw"
    exit 1
    ;;
esac

# Total number of council members defined in the preset.
MEMBER_COUNT=${#NAMES[@]}

# ─── Calculate Resources Per Member ───────────────────────────
# Iterate over all council members, compute their resource requirements
# using the calculator functions, and display a formatted table.
# Results are stored in parallel arrays MEM_MB, CORE_COUNT, and DISK_GB,
# which are used later when creating the actual containers/VMs.

declare -a MEM_MB CORE_COUNT DISK_GB

# Running totals for the resource summary and validation.
TOTAL_CORES=0
TOTAL_MEM=0
TOTAL_DISK=0

echo "Preset: ${PRESET}"
echo "Members: ${MEMBER_COUNT}"
echo ""
# Print a formatted table header for the resource allocation summary.
echo "┌────────────────────┬───────┬────────────────────────┬─────────┬───────┬────────┐"
echo "│ Name               │ Tier  │ Model                  │ RAM     │ Cores │ Disk   │"
echo "├────────────────────┼───────┼────────────────────────┼─────────┼───────┼────────┤"

for i in $(seq 0 $((MEMBER_COUNT - 1))); do
  # Calculate RAM from model parameter count.
  M=$(calc_memory "${PARAMS[$i]}")
  # Use forced cores if set (non-zero), otherwise auto-calculate from params.
  # FORCED_CORES allows presets to override the formula for better resource
  # balancing across the entire council.
  if [ "${FORCED_CORES[$i]+x}" ] && [ "${FORCED_CORES[$i]}" -gt 0 ]; then
    C="${FORCED_CORES[$i]}"
  else
    C=$(calc_cores "${PARAMS[$i]}")
  fi
  # Calculate disk space from model parameter count.
  D=$(calc_disk "${PARAMS[$i]}")

  # Tier 1 (Director VM) gets extra overhead: +2 GB RAM and +5 GB disk.
  # VMs need more resources than LXC containers because they run a full
  # kernel, init system, and may need extra memory for the VM hypervisor.
  if [ "${TIERS[$i]}" -eq 1 ]; then
    M=$((M + 2048))
    D=$((D + 5))
  fi

  # Store calculated values in the resource arrays for later use.
  MEM_MB+=("$M")
  CORE_COUNT+=("$C")
  DISK_GB+=("$D")

  # Accumulate running totals for the summary and resource validation.
  TOTAL_CORES=$((TOTAL_CORES + C))
  TOTAL_MEM=$((TOTAL_MEM + M))
  TOTAL_DISK=$((TOTAL_DISK + D))

  # Format the type label for the table display:
  #   "VM" for Tier 1 (Director), "LXC*" for Tier 2 (Coordinators),
  #   "LXC" for Tier 3 (Specialists). The asterisk marks coordinators.
  TYPE_LABEL="${TYPES[$i]}"
  [ "${TIERS[$i]}" -eq 1 ] && TYPE_LABEL="VM"
  [ "${TIERS[$i]}" -eq 2 ] && TYPE_LABEL="LXC*"
  [ "${TIERS[$i]}" -eq 3 ] && TYPE_LABEL="LXC"

  # Print a formatted row for this council member.
  printf "│ %-18s │ T%d %-2s │ %-22s │ %4d MB │   %2d  │ %3d GB │\n" \
    "${NAMES[$i]}" "${TIERS[$i]}" "$TYPE_LABEL" "${MODELS[$i]}" "$M" "$C" "$D"
done

# Print the table footer and resource totals.
echo "└────────────────────┴───────┴────────────────────────┴─────────┴───────┴────────┘"
echo ""
echo "Total resources needed:"
echo "  CPU:    ${TOTAL_CORES} cores"
echo "  Memory: $((TOTAL_MEM / 1024)) GB ($((TOTAL_MEM)) MB)"
echo "  Disk:   ${TOTAL_DISK} GB"
echo ""

# ─── Resource Validation ─────────────────────────────────────
# Compare the total resources needed by the council against the host's
# available hardware, applying the MAX_RESOURCE_PCT safety limit.
# This prevents accidentally over-provisioning and starving the host OS.
# Warnings are displayed but do not block the installation — the user
# is prompted for confirmation regardless.

# Read host hardware info from /proc (Linux-specific).
HOST_MEM=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print int($2/1024)}' || echo 0)
HOST_CORES=$(nproc 2>/dev/null || echo 0)

if [ "$HOST_MEM" -gt 0 ] && [ "$HOST_CORES" -gt 0 ]; then
  # Calculate the maximum allowable resources based on the percentage limit.
  MAX_MEM=$((HOST_MEM * MAX_RESOURCE_PCT / 100))
  MAX_CORES=$((HOST_CORES * MAX_RESOURCE_PCT / 100))
  echo "Host: ${HOST_MEM} MB RAM, ${HOST_CORES} cores"
  echo "Limit (${MAX_RESOURCE_PCT}%): ${MAX_MEM} MB RAM, ${MAX_CORES} cores"
  echo ""

  # Warn if the council would exceed the memory limit.
  if [ "$TOTAL_MEM" -gt "$MAX_MEM" ]; then
    echo "WARNING: Council needs ${TOTAL_MEM} MB but limit is ${MAX_MEM} MB"
    echo "Consider using a smaller preset or increasing --max-pct"
  fi
  # Warn if the council would exceed the CPU core limit.
  if [ "$TOTAL_CORES" -gt "$MAX_CORES" ]; then
    echo "WARNING: Council needs ${TOTAL_CORES} cores but limit is ${MAX_CORES}"
  fi
fi

# ─── User Confirmation ───────────────────────────────────────
# Pause for explicit user confirmation before creating containers/VMs.
# This is a destructive operation that allocates real Proxmox resources.
# Default is "No" (uppercase N) to prevent accidental execution.
read -p "Proceed with setup? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# ─── Create Containers and VMs ────────────────────────────────
# Main provisioning loop: iterates over all council members and creates
# their Proxmox containers (LXC) or virtual machines (VM). For each member:
#   1. Creates the container/VM with the calculated resource allocations.
#   2. For LXC containers: installs Ollama, enables its service, and pulls
#      the assigned LLM model — all automated via `pct exec`.
#   3. For VMs: creates the VM but notes that OS installation from ISO
#      may require manual intervention.
#   4. Retrieves the assigned IP address for council.json configuration.
#   5. Builds a JSON entry for the council configuration file.

# COUNCIL_MEMBERS accumulates JSON entries for all members, used later
# to write the council.json configuration file.
COUNCIL_MEMBERS=""

for i in $(seq 0 $((MEMBER_COUNT - 1))); do
  # Extract this member's configuration from the parallel arrays.
  NAME="${NAMES[$i]}"
  MODEL="${MODELS[$i]}"
  TIER="${TIERS[$i]}"
  TYPE="${TYPES[$i]}"
  MEM="${MEM_MB[$i]}"
  CORE="${CORE_COUNT[$i]}"
  DSK="${DISK_GB[$i]}"
  ROLE="${ROLES[$i]}"
  BRANCH="${BRANCHES[$i]}"
  # Calculate this member's VMID by adding its index to the base VMID.
  VMID=$((BASE_VMID + i))
  # Ollama always serves on port 11434 by default.
  PORT=11434

  # Print a header for this member's provisioning output.
  echo ""
  echo "━━━ [Tier ${TIER}] ${NAME} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Model:  ${MODEL}"
  echo "  Type:   ${TYPE} (VMID: ${VMID})"
  echo "  Memory: ${MEM} MB, Cores: ${CORE}, Disk: ${DSK} GB"

  if [ "$TYPE" = "vm" ]; then
    # ── Create a Full VM (Tier 1 Director) ──
    # Uses `qm create` (Proxmox QEMU manager) to create a full virtual machine.
    # VMs provide better isolation and direct hardware access for large models.
    #   --scsihw virtio-scsi-single : High-performance SCSI controller
    #   --scsi0                     : Primary disk on the specified storage pool
    #   --ide2                      : Attaches the Ubuntu ISO as a CD-ROM for install
    #   --boot "order=scsi0;ide2"   : Boot from disk first, then CD-ROM
    #   --ostype l26                : Linux kernel 2.6+ (for KVM optimizations)
    #   --start 1                   : Auto-start the VM after creation
    echo "  Creating VM..."
    qm create "$VMID" \
      --name "council-${NAME}" \
      --cores "$CORE" \
      --memory "$MEM" \
      --scsihw virtio-scsi-single \
      --scsi0 "${STORAGE}:${DSK}" \
      --net0 "virtio,bridge=${BRIDGE}" \
      --ide2 "${ISO_STORAGE}:iso/${ISO_IMAGE},media=cdrom" \
      --boot "order=scsi0;ide2" \
      --ostype l26 \
      --start 1 2>/dev/null || echo "  (VM creation may need manual ISO boot)"

    # VMs boot from an ISO and typically need manual OS installation.
    # Print instructions for the operator to complete setup manually.
    echo "  Note: Tier 1 VM may need manual OS install from ISO, then:"
    echo "    qm exec ${VMID} -- bash -c 'curl -fsSL https://ollama.ai/install.sh | sh && ollama pull ${MODEL}'"

  else
    # ── Create an LXC Container (Tier 2/3) ──
    # Uses `pct create` (Proxmox Container Toolkit) to create a lightweight
    # Linux container from the Ubuntu template.
    #   --unprivileged 1   : Security — maps container root to non-root host UID
    #   --features nesting=1 : Allows nested containers (for future flexibility)
    #   --start 1          : Auto-start the container immediately after creation
    echo "  Creating LXC container..."
    pct create "$VMID" "$TEMPLATE" \
      --hostname "council-${NAME}" \
      --cores "$CORE" \
      --memory "$MEM" \
      --rootfs "${STORAGE}:${DSK}" \
      --net0 "name=eth0,bridge=${BRIDGE},ip=dhcp" \
      --unprivileged 1 \
      --features nesting=1 \
      --start 1

    # Wait for the container to fully boot and get a DHCP address
    # before attempting to execute commands inside it.
    echo "  Waiting for boot..."
    sleep 8

    # Install Ollama inside the container and pull the assigned model.
    # This runs a multi-step provisioning script inside the container:
    #   1. Update apt package index
    #   2. Install curl (needed to download the Ollama installer)
    #   3. Download and run the official Ollama install script
    #   4. Enable and start the Ollama systemd service
    #   5. Wait 5 seconds for Ollama to initialize
    #   6. Pull (download) the assigned LLM model weights
    # Output is indented for readability in the console.
    echo "  Installing Ollama and pulling ${MODEL}..."
    pct exec "$VMID" -- bash -c "
      apt-get update -qq &&
      apt-get install -y -qq curl &&
      curl -fsSL https://ollama.ai/install.sh | sh &&
      systemctl enable ollama &&
      systemctl start ollama &&
      sleep 5 &&
      ollama pull ${MODEL}
    " 2>&1 | while read line; do echo "    ${line}"; done
  fi

  # ── Retrieve the Container/VM IP Address ──
  # The IP is needed for the council.json configuration so OpenClaw knows
  # how to reach each council member's Ollama API endpoint.
  if [ "$TYPE" = "vm" ]; then
    # For VMs, use the QEMU Guest Agent to query network interfaces.
    # Falls back to "pending" if the guest agent is not yet available.
    CT_IP=$(qm guest cmd "$VMID" network-get-interfaces 2>/dev/null | grep -o '"ip-address":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "pending")
  else
    # For LXC containers, execute `hostname -I` inside the container
    # and extract the first IP address.
    CT_IP=$(pct exec "$VMID" -- hostname -I 2>/dev/null | awk '{print $1}' || echo "pending")
  fi

  echo "  IP: ${CT_IP}"
  echo "  Ready: ${MODEL} @ ${CT_IP}:${PORT}"

  # ── Build JSON Entry for Council Configuration ──
  # Accumulate a JSON object for this member into COUNCIL_MEMBERS.
  # The JSON includes all metadata OpenClaw needs to communicate with
  # and manage this council member:
  #   name          — unique identifier
  #   role          — functional role (director, coder, reviewer, etc.)
  #   tier          — hierarchy level (1, 2, or 3)
  #   branch        — branch affiliation (logical, creative)
  #   model         — Ollama model tag
  #   backend       — LLM backend type (always "ollama" for council members)
  #   speciality    — human-readable description of the member's expertise
  #   endpoint      — HTTP URL to the member's Ollama API
  #   containerId   — Proxmox VMID for management operations
  #   containerType — "vm" or "lxc" for type-specific management commands
  SEP=""
  [ $i -gt 0 ] && SEP=","
  COUNCIL_MEMBERS="${COUNCIL_MEMBERS}${SEP}
    {
      \"name\": \"${NAME}\",
      \"role\": \"${ROLE}\",
      \"tier\": ${TIER},
      \"branch\": \"${BRANCH}\",
      \"model\": \"${MODEL}\",
      \"backend\": \"ollama\",
      \"speciality\": \"${SPECIALITIES[$i]}\",
      \"endpoint\": \"http://${CT_IP}:${PORT}\",
      \"containerId\": \"${VMID}\",
      \"containerType\": \"${TYPE}\"
    }"
done

# ─── Write Council Configuration File ─────────────────────────
# Generate the council.json file that OpenClaw reads at startup to know
# about all council members, their endpoints, roles, and consensus settings.
#
# Key configuration fields:
#   name                — preset name for identification
#   maxRounds           — maximum deliberation rounds before forcing a decision
#   consensusThreshold  — minimum agreement ratio (0.75 = 75%) for consensus
#   timeoutMs           — maximum time (5 minutes) for a council deliberation
#   members             — array of all council member definitions
#   discovery.probeHosts — IP addresses OpenClaw should probe to verify
#                          that council members are online and responsive

COUNCIL_JSON="/opt/openclaw/council.json"
# Ensure the target directory exists (should already exist from install-openclaw.sh).
mkdir -p "$(dirname "$COUNCIL_JSON")"

# Write the council configuration using a heredoc. Note: the CEOF delimiter
# is NOT single-quoted, so variables ($PRESET, $COUNCIL_MEMBERS, etc.) are
# expanded. This is intentional — we need the computed values in the JSON.
cat > "$COUNCIL_JSON" << CEOF
{
  "name": "${PRESET}",
  "maxRounds": 3,
  "consensusThreshold": 0.75,
  "timeoutMs": 300000,
  "members": [${COUNCIL_MEMBERS}
  ],
  "discovery": {
    "probeHosts": [$(
      # Build a comma-separated list of council member IP addresses
      # for service discovery probing. Re-queries each member's IP
      # to ensure the most current addresses are recorded.
      SEP=""
      for i in $(seq 0 $((MEMBER_COUNT - 1))); do
        VMID_I=$((BASE_VMID + i))
        CT_IP_I=$(
          if [ "${TYPES[$i]}" = "vm" ]; then
            qm guest cmd "$VMID_I" network-get-interfaces 2>/dev/null | grep -o '"ip-address":"[^"]*"' | head -1 | cut -d'"' -f4 || echo ""
          else
            pct exec "$VMID_I" -- hostname -I 2>/dev/null | awk '{print $1}' || echo ""
          fi
        )
        # Only include IPs that were successfully resolved (not empty or "pending").
        if [ -n "$CT_IP_I" ] && [ "$CT_IP_I" != "pending" ]; then
          printf '%s"%s"' "$SEP" "$CT_IP_I"
          SEP=", "
        fi
      done
    )]
  }
}
CEOF

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  3-Tier Council setup complete!                        ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  Config: ${COUNCIL_JSON}"
echo "  Members: ${MEMBER_COUNT}"
echo ""
echo "  Tier 1 (Director VM):"
for i in $(seq 0 $((MEMBER_COUNT - 1))); do
  [ "${TIERS[$i]}" -eq 1 ] && echo "    VMID $((BASE_VMID + i)): ${NAMES[$i]} (${MODELS[$i]}, ${MEM_MB[$i]}MB)"
done
echo ""
echo "  Tier 2 (Branch Coordinators):"
for i in $(seq 0 $((MEMBER_COUNT - 1))); do
  [ "${TIERS[$i]}" -eq 2 ] && echo "    VMID $((BASE_VMID + i)): ${NAMES[$i]} [${BRANCHES[$i]}] (${MODELS[$i]}, ${MEM_MB[$i]}MB)"
done
echo ""
echo "  Tier 3 (Specialists):"
for i in $(seq 0 $((MEMBER_COUNT - 1))); do
  [ "${TIERS[$i]}" -eq 3 ] && echo "    VMID $((BASE_VMID + i)): ${NAMES[$i]} [${BRANCHES[$i]}] (${MODELS[$i]}, ${MEM_MB[$i]}MB)"
done
echo ""
echo "  Total: ${TOTAL_CORES} cores, $((TOTAL_MEM / 1024)) GB RAM, ${TOTAL_DISK} GB disk"
echo ""
echo "  Restart OpenClaw to load the council:"
echo "    systemctl restart openclaw"
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Memory Persistence                                     ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  OpenClaw persists all memory to disk automatically:"
echo "    ./data/graph-memory.json   — Knowledge graph (facts, contacts, experiences)"
echo "    ./data/vector-store.json   — Embedding vectors for RAG"
echo "    ./data/personality/        — User profiles, conversations, learned facts"
echo ""
echo "  For dedicated storage, create a container (VMID 310):"
echo "    pct create 310 \$TEMPLATE \\"
echo "      --hostname openclaw-storage \\"
echo "      --cores 2 --memory 4096 \\"
echo "      --rootfs ${STORAGE}:50 \\"
echo "      --net0 name=eth0,bridge=${BRIDGE},ip=dhcp \\"
echo "      --unprivileged 1 --start 1"
echo ""
echo "  Mount a ZFS dataset for durable persistence:"
echo "    zfs create tank/openclaw-data"
echo "    pct set 301 -mp0 /tank/openclaw-data,mp=/opt/openclaw/data"
echo ""
echo "  Then set persistPath in openclaw.json:"
echo "    { \"memory\": { \"persistPath\": \"/opt/openclaw/data\" } }"
