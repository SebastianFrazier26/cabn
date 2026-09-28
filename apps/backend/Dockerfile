# syntax=docker/dockerfile:1.7
# Build context is the monorepo root, not this directory — `workspace:*`
# deps mean the backend can't be built in isolation:
#   docker build -f apps/backend/Dockerfile -t cabn-backend .

FROM node:22-slim AS base
RUN corepack enable
WORKDIR /repo

# Separate fetch stage so `pnpm fetch` (populates the store from lockfile +
# package.json manifests alone) gets cached across builds even when source
# files change — only a dependency edit invalidates this layer.
FROM base AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/world-schema/package.json packages/world-schema/package.json
COPY packages/converter/package.json packages/converter/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY apps/backend/package.json apps/backend/package.json
RUN pnpm fetch

FROM fetch AS build
COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm --filter @cabn/world-schema --filter @cabn/converter build
RUN pnpm --filter @cabn/backend build
# Prunes to prod-only deps and resolves every workspace:* dep to a real,
# copied package — the runtime stage below never sees pnpm's workspace
# symlinks or devDependencies.
RUN pnpm --filter @cabn/backend deploy --prod /out/backend

FROM node:22-slim AS runtime
ENV NODE_ENV=production
RUN groupadd --system cabn && useradd --system --gid cabn --uid 1001 cabn
WORKDIR /app
COPY --from=build --chown=cabn:cabn /out/backend ./
USER cabn
EXPOSE 8080
CMD ["node", "dist/server.js"]
