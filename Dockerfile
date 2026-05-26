# ───────────────────────────────────────────────────────────────────────────
# agent-identity Docker sidecar — suggestion #2
# ───────────────────────────────────────────────────────────────────────────
#
# Python agents, Go services, and Ruby apps have no Node.js dependency.
# Run this sidecar alongside any polyglot service and call /api/resolve
# over HTTP. The contract is identical to the TypeScript router.
#
# Usage:
#   docker build -t datacules/agent-identity .
#   docker run -p 3001:3001 --env-file .env.local datacules/agent-identity
#
# Or in docker-compose.yml:
#   services:
#     agent-identity:
#       image: datacules/agent-identity
#       ports: ['3001:3001']
#       env_file: .env.local
#     my-python-app:
#       build: .
#       environment:
#         AGENT_IDENTITY_URL: http://agent-identity:3001
# ───────────────────────────────────────────────────────────────────────────

FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies for the full monorepo (workspace hoisting)
COPY package.json ./
COPY packages/core/package.json ./packages/core/
COPY src/package.json ./src/ 2>/dev/null || true
RUN npm install --workspace=packages/core

# Build just the core package
COPY packages/core ./packages/core
RUN npm run build --workspace=packages/core

# Build the Next.js API routes (standalone output)
COPY . .
RUN npm install
RUN npm run build

# ─── Production stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Only copy what Next.js standalone needs
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "server.js"]
