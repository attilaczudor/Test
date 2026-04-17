# ──────────────────────────────────────────────────────────────
# OpenClaw v2 — Docker Image
#
# Multi-stage build for production deployment.
# Inspired by upstream OpenClaw's container approach.
#
# Build:
#   docker build -t openclaw:latest .
#
# Run:
#   docker run -d \
#     --name openclaw \
#     -p 3100:3100 -p 3101:3101 \
#     -v openclaw-data:/app/data \
#     -e OPENCLAW_CONFIG=/app/openclaw.json \
#     openclaw:latest
#
# With Ollama (host network):
#   docker run -d \
#     --name openclaw \
#     --network host \
#     -v openclaw-data:/app/data \
#     openclaw:latest
# ──────────────────────────────────────────────────────────────

# ── Stage 1: Build ────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /build

# Copy package files first for layer caching
COPY package.json package-lock.json tsconfig.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source
COPY src/ src/

# Build TypeScript
RUN npx tsc --outDir dist

# ── Stage 2: Production ──────────────────────────────────────
FROM node:22-slim AS runtime

# Security: run as non-root
RUN groupadd --gid 1001 openclaw && \
    useradd --uid 1001 --gid 1001 --create-home openclaw

WORKDIR /app

# Copy package files and install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built output
COPY --from=builder /build/dist ./dist

# Copy deploy scripts
COPY deploy/ ./deploy/

# Create data directory for persistence
RUN mkdir -p /app/data && chown -R openclaw:openclaw /app/data

# Switch to non-root user
USER openclaw

# Default config path
ENV OPENCLAW_CONFIG=/app/openclaw.json
ENV NODE_ENV=production

# Expose gateway (WebSocket) and UI ports
EXPOSE 3100 3101

# Health check against gateway
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Persistent data volume
VOLUME ["/app/data"]

# Start OpenClaw
CMD ["node", "dist/index.js"]
