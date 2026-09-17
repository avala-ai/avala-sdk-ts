# Hosted MCP Worker adapter

This folder is an opt-in hosting adapter for the existing MCP HTTP server.
Reuse `src/httpServer.ts`, the existing SDK catalog, Auth0 broker and Django
permissions. Do not introduce a parallel catalog, OAuth flow or Durable Object.
The Node/stdio entry points remain independent of this folder.

From `sdks/typescript/packages/mcp-server`:

- `bun run worker:check` regenerates compatibility-date runtime types and checks
  the Worker. The large generated runtime declaration stays ignored.
- `bun run worker:build` bundles with Wrangler's dry-run option only.
- `bun run worker:test` runs the real workerd path with local upstream fixtures.
- `bun run build && bun run lint && bun run test` checks shared Node behavior too.

Install workspace dependencies and build `../sdk` first. Worker tools require
Node 22; existing Node 18/20 SDK checks must remain usable. Keep the workerd
harness aligned with pinned Wrangler and the compatibility date. Config defaults
must stay disabled with no routes, workers.dev or preview exposure.

Treat the platform client IP, Fetch header normalization, request-local
credentials, cross-runtime confirmation keys and once-only origin fallback as
security contracts. Any change needs real workerd regression coverage. Never
log bindings, OAuth tokens, raw upstream bodies or exception details.

The origin fallback mode asserts a verified Route to the retained AWS origin;
it is not valid on a Custom Domain. Local fixtures cannot establish live DNS,
ALB IP semantics or current deployed-artifact parity. Rollout inputs and remaining
acceptance gates are in
`reports/infrastructure/mcp/cloudflare-runtime-candidate.md` at repository root.
No deployment, secret/routing change or AWS teardown follows from local tests.
