# agent-identity sidecar
#
# Multi-stage build:
#   Stage 1 (builder) — installs all deps and compiles TypeScript
#   Stage 2 (runtime) — copies only the compiled output and prod deps
#
# Build:
#   docker build -t datacules/agent-identity .
#
# Run:
#   docker run -p 3001:3001 \
#     -e AGENT_IDENTITY_CREDENTIALS_JSON='[...]' \
#     -e AGENT_IDENTITY_RULES_JSON='[...]' \
#     datacules/agent-identity
#
# Health check:
#   curl http://localhost:3001/health

# ─── Stage 1: build ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /build

# Copy workspace manifests first for layer caching
COPY package.json package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/sidecar/package.json packages/sidecar/package.json

RUN npm install --workspaces --ignore-scripts

# Copy source
COPY packages/core/src packages/core/src
COPY packages/core/tsconfig.json packages/core/tsconfig.json
COPY packages/sidecar/src packages/sidecar/src
COPY packages/sidecar/tsconfig.json packages/sidecar/tsconfig.json

# Build core package first, then sidecar
RUN npm run build --workspace=packages/core
RUN npm run build --workspace=packages/sidecar

# ─── Stage 2: runtime ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

# Non-root user for security
RUN addgroup -S aiagent && adduser -S aiagent -G aiagent

# Copy built artifacts
COPY --from=builder /build/packages/core/dist ./packages/core/dist
COPY --from=builder /build/packages/core/package.json ./packages/core/package.json
COPY --from=builder /build/packages/sidecar/dist ./packages/sidecar/dist
COPY --from=builder /build/packages/sidecar/package.json ./packages/sidecar/package.json
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package.json ./package.json

USER aiagent

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "packages/sidecar/dist/server.js"]
