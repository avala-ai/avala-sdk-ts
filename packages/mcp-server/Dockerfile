# =============================================================================
# Hosted MCP server (avala-mcp-server) — Streamable HTTP transport
#
# This is the SAME package published as `npx @avala-ai/mcp-server` for stdio
# use (plan §4.6: "the open code IS the hosted code") — this Dockerfile just
# builds its HTTP entry point instead of running the stdio one directly.
# See infra/mcp_server.tf and
# security/docs/plans/mcp-platform-auth-model.md §4.5/§9.2.
#
# Confirmed deployment contract (2026-08-23, from the transport
# implementer): endpoint POST /mcp, health GET/HEAD /healthz -> 200
# unauthenticated, PORT env (default 8080), Node >=20 (tested 20/22). STATELESS
# 2026-07-28 requests are plain JSON; the 2025 compatibility path may encode a
# single response as SSE. Neither path uses sticky sessions or persistent
# state. SIGTERM has a 10s force-exit — infra/mcp_server.tf sets ECS
# stopTimeout=15 to cover it. The app enforces a 4MB body cap and an explicit
# browser Origin allowlist.
#
# ⚠️ BUILD CONTEXT: build with `sdks/typescript/` (the bun workspace root —
# package.json + bun.lock + tsconfig.base.json + packages/*) as the Docker
# build context, NOT this file's own directory and NOT the repo root. From
# the repo root:
#
#   docker build \
#     -f sdks/typescript/packages/mcp-server/Dockerfile \
#     -t avala-mcp-server \
#     sdks/typescript
#
# @avala-ai/mcp-server depends on @avala-ai/sdk as "workspace:*" (see
# ../mcp-server/package.json), and @avala-ai/sdk's package.json "main" /
# "module" fields point at its OWN dist/ output — so the SDK package must be
# present and built before mcp-server's build runs, which is why both
# packages have to travel in one build context. (Plan §4.6 floats decoupling
# this to a published version range later; today it is still workspace:*.)
#
# Production publication is wired through scripts/build_images.sh,
# push_images.sh, and variables.sh under the `mcp-server` selector. Keep that
# build's context at sdks/typescript/ when this Dockerfile moves: the selector
# contract is enforced by scripts/tests/test_mcp_server_image_publication.py.
# The target ECR repo is aws_ecr_repository.mcp_server_repository
# ("avala-mcp-server", infra/mcp_server.tf).
#
# tsup.config.ts builds BOTH src/index.ts (stdio) and src/http.ts, so the
# runtime command below is produced by this build rather than copied from a
# separate hosted-only implementation.
# =============================================================================

FROM oven/bun:1 AS builder
WORKDIR /app

# Manifests first for Docker layer caching — dependencies change far less
# often than source.
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/mcp-server/package.json packages/mcp-server/package.json

RUN bun install --frozen-lockfile

# Full source, then build. The SDK MUST build first: mcp-server imports
# @avala-ai/sdk, bun's workspace symlink resolves to packages/sdk on disk
# (not a registry copy), and its package.json points at ./dist/* — so an
# out-of-order build ships whatever dist/ the SDK last happened to have, or
# fails outright on a clean checkout with no dist/ at all.
COPY packages/sdk packages/sdk
COPY packages/mcp-server packages/mcp-server

RUN bun run --filter '@avala-ai/sdk' build
RUN bun run --filter '@avala-ai/mcp-server' build

# Drop devDependencies (tsup, typescript, vitest, ...) now that the build is
# done, so the runtime image doesn't carry them. Bun 1.4 defaults new
# workspaces to its isolated linker, whose dependencies live only under the
# .bun virtual store. That layout works when Bun launches the program but Node
# cannot resolve @modelcontextprotocol/server, @avala-ai/sdk, or zod from the MCP
# package. The runtime deliberately uses Node, so materialize the supported
# hoisted layout here. Do not remove --linker hoisted without running the
# Dockerfile's Node/health smoke test.
RUN rm -rf node_modules && bun install --frozen-lockfile --production --linker hoisted

# -----------------------------------------------------------------------------
# Runtime: plain Node, not bun. The published package only requires
# Node >=20 (packages/mcp-server/package.json "engines"), and running the
# hosted service on the same runtime as everyone's local
# `npx @avala-ai/mcp-server` keeps one supported code path instead of two.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ARG AVALA_MCP_BUILD_SHA=unknown
ARG AVALA_MCP_RELEASE_TAG=local

# Carry the whole pruned /app tree so bun's relative workspace symlinks
# (node_modules/@avala-ai/sdk -> ../../packages/sdk) keep resolving —
# cherry-picking individual node_modules entries across stages is how that
# silently breaks.
COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages/sdk/package.json packages/sdk/package.json
COPY --from=builder /app/packages/sdk/dist packages/sdk/dist
COPY --from=builder /app/packages/mcp-server/package.json packages/mcp-server/package.json
COPY --from=builder /app/packages/mcp-server/dist packages/mcp-server/dist

ENV NODE_ENV=production
ENV PORT=8080
ENV AVALA_MCP_BUILD_SHA=$AVALA_MCP_BUILD_SHA
ENV AVALA_MCP_RELEASE_TAG=$AVALA_MCP_RELEASE_TAG

LABEL org.opencontainers.image.revision=$AVALA_MCP_BUILD_SHA
LABEL ai.avala.release-tag=$AVALA_MCP_RELEASE_TAG

# node:20-alpine ships a non-root "node" user (uid 1000) — this service makes
# outbound HTTPS calls to Django and nothing else, so there is no reason to
# run it as root. Files above are copied in as root but left world-readable
# by default, so this only removes privilege, it doesn't need an extra chown.
USER node

WORKDIR /app/packages/mcp-server
EXPOSE 8080

CMD ["node", "dist/http.js"]
