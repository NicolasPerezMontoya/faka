# Multi-stage Dockerfile for the faka orchestrator.
# Build context = repo root so pnpm workspaces resolve correctly.
# RESEARCH §10 (Railway monorepo) + PATTERNS §3.H.
#
# Build from repo root:
#   docker build -f apps/orchestrator/Dockerfile -t faka-orch .

# ─── Stage 1: build ──────────────────────────────────────────────
FROM node:22-alpine AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

WORKDIR /app

# Copy lockfile (if present) + workspace manifests first (cache-friendly).
# The wildcard on pnpm-lock.yaml makes the COPY tolerant when no lockfile
# is committed — matches the Vercel build's `--no-frozen-lockfile` posture
# until we land a lockfile generated from a network-stable env.
COPY pnpm-lock.yaml* pnpm-workspace.yaml package.json .npmrc ./
COPY turbo.json tsconfig.json ./
COPY packages/config/package.json ./packages/config/
COPY packages/db/package.json ./packages/db/
COPY packages/schema/package.json ./packages/schema/
COPY packages/connectors/package.json ./packages/connectors/
COPY packages/llm/package.json ./packages/llm/
COPY packages/ui/package.json ./packages/ui/
COPY packages/auth/package.json ./packages/auth/
COPY apps/dashboard/package.json ./apps/dashboard/
COPY apps/orchestrator/package.json ./apps/orchestrator/
COPY scripts/discovery/package.json ./scripts/discovery/

RUN pnpm install --no-frozen-lockfile --filter @faka/orchestrator...

# Copy the rest and build only what the orchestrator needs.
COPY . .
RUN pnpm --filter @faka/orchestrator... build

# Prune dev deps for runtime image. pnpm v10 requires --legacy unless every
# workspace package opts into inject-workspace-packages; we don't, so use the
# legacy deploy strategy (matches the pre-v10 behavior).
RUN pnpm --filter @faka/orchestrator --prod deploy --legacy /out

# ─── Stage 2: runtime ────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Copy the deployed app (production deps + compiled dist).
COPY --from=builder /out /app

EXPOSE 8080

# Default CMD is the web server; Railway cron services override via the
# serviceInstance.startCommand (e.g. `pnpm tsx src/cron.ts <job>`). We use
# tsx at runtime because workspace packages (`@faka/connectors`, etc.)
# expose their `main` as TypeScript source — Node 22 refuses to strip
# types under node_modules, so tsx handles compilation on demand.
CMD ["node_modules/.bin/tsx", "src/server.ts"]
