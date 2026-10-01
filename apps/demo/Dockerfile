# syntax=docker/dockerfile:1.7
# The hosted demo: the production build served by Caddy, which sends the CSP
# (frame-ancestors included) as a real response header. Build context is the
# monorepo root, like the backend's:
#   docker build -f apps/demo/Dockerfile -t cabn-demo .

FROM node:22-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/world-schema/package.json packages/world-schema/package.json
COPY packages/converter/package.json packages/converter/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY apps/backend/package.json apps/backend/package.json
COPY apps/demo/package.json apps/demo/package.json
COPY tools/asset-pipeline/package.json tools/asset-pipeline/package.json
RUN pnpm fetch

FROM fetch AS build
COPY . .
RUN pnpm install --frozen-lockfile --offline
# The demo's prebuild needs the cli's dist/ (build-world.mjs refuses a stale
# one), so the whole workspace builds in topological order.
RUN pnpm -r build
RUN node apps/demo/scripts/render-caddyfile.mjs apps/demo/Caddyfile /repo/Caddyfile.rendered

FROM caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b AS runtime
# With admin, auto-HTTPS and config persistence off Caddy writes nothing it
# keeps, but it still resolves its XDG dirs at start; /tmp is writable for
# the unprivileged user.
ENV XDG_CONFIG_HOME=/tmp/caddy-config XDG_DATA_HOME=/tmp/caddy-data
COPY --from=build /repo/Caddyfile.rendered /etc/caddy/Caddyfile
COPY --from=build /repo/apps/demo/dist /srv
USER 65534:65534
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
