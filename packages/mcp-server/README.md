# @avala-ai/mcp-server

[![npm version](https://img.shields.io/npm/v/@avala-ai/mcp-server)](https://www.npmjs.com/package/@avala-ai/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for the [Avala API](https://avala.ai/docs). It lets agents such as Claude and Codex manage the Avala Physical AI data loop through the same tenant-safe APIs used by the platform.

## Installation

```bash
npm install -g @avala-ai/mcp-server
```

Requires Node.js 20+.

## Setup

Set your API key:

```bash
export AVALA_API_KEY="avk_your_api_key"
```

MCP is read-only unless you explicitly enable mutation tools:

```bash
export AVALA_MCP_ENABLE_MUTATIONS=true
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "avala": {
      "command": "npx",
      "args": ["-y", "@avala-ai/mcp-server"],
      "env": {
        "AVALA_API_KEY": "avk_your_api_key"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add avala -- npx -y @avala-ai/mcp-server
```

### Direct Usage

```bash
avala-mcp-server
```

## Hosted mode (Streamable HTTP)

The package also ships a stateless [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports#streamable-http) entry, used by Avala's hosted deployment:

```bash
node dist/http.js
```

- `POST /mcp` — the MCP endpoint. Every request carries either `X-Avala-Api-Key: <key>`, a 40-hex Avala key as `Authorization: Bearer`, or an Auth0 OAuth token issued for the exact MCP resource. OAuth subject tokens are verified at this boundary and exchanged through RFC 8693; only the resulting API-audience token reaches Avala's REST API.
- `GET /.well-known/oauth-protected-resource/mcp` — public RFC 9728 protected-resource metadata. Authentication failures point clients here through `WWW-Authenticate`, enabling OAuth-capable clients to discover Auth0 automatically.
- `GET /` — public endpoint/discovery summary.
- `GET /healthz` — unauthenticated liveness probe.
- **Dual protocol**: current clients use the stateless 2026-07-28 request
  envelope and `Mcp-Method` / `Mcp-Name` routing headers. The same factory
  retains the SDK's stateless 2025 compatibility path for existing clients.
- **Read-only**: the hosted transport always serves the read-only catalog. Write/delete tools are stdio-only until durable confirmation, idempotency, and audit-intent controls exist; `AVALA_MCP_ENABLE_MUTATIONS` is ignored here by design.
- Browser `Origin` validation applies to `/mcp`; public liveness and discovery routes contain no credentialed functionality.

Hosted operators must configure `AVALA_MCP_INTERNAL_CLIENT_SECRET`, `AVALA_MCP_OAUTH_RESOURCE`, `AVALA_MCP_OAUTH_ISSUER`, `AVALA_MCP_OAUTH_API_AUDIENCE`, `AVALA_MCP_OAUTH_CLIENT_ID`, `AVALA_MCP_OAUTH_CLIENT_SECRET`, and the space-separated `AVALA_MCP_OAUTH_SCOPES`. `PORT`, `AVALA_BASE_URL`, and the comma-separated `ALLOWED_ORIGINS` remain optional. Confidential values belong in the deployment secret store, never environment templates or source control.

Unlike stdio mode, no `AVALA_API_KEY` environment variable is read — the server is multi-tenant, one credential per request.

## Available Tools

| Tool Category     | Description                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Datasets          | List and inspect datasets, sequences, frames, calibration, ingest health, capture campaigns, and submissions                                           |
| Projects          | List and inspect projects                                                                                                                              |
| Exports           | List, inspect, and create annotation exports                                                                                                           |
| Fleet             | Device management, recordings, events, alerts, rules                                                                                                   |
| Agents            | List and inspect automation agents                                                                                                                     |
| Webhooks          | List and inspect webhook subscriptions                                                                                                                 |
| Storage           | List storage configurations                                                                                                                            |
| Quality           | Quality targets, per-capture verdict evidence, campaign acceptance yield and coverage, and consensus scoring                                           |
| Annotation Issues | List and manage annotation issue data                                                                                                                  |
| Organizations     | List organizations and members                                                                                                                         |
| Slices            | List and inspect data slices                                                                                                                           |
| Stats             | Get overview statistics for your account                                                                                                               |
| **Workflows**     | **Composite tools: fleet health overview, project quality summary, workspace overview, annotation pipeline creation**                                  |
| Staff             | Avala staff only: read-only proxies to the staff SQL sandbox (`staff_query`, `staff_aggregate`, `staff_describe_table`)                                |
| Note              | Write/delete tools (`create_*`, `delete_*`, `test_storage_config`, `evaluate_quality`, `compute_consensus`) require `AVALA_MCP_ENABLE_MUTATIONS=true`. |

## Documentation

- [MCP Setup Guide](https://avala.ai/docs/integrations/mcp-setup)
- [TypeScript SDK Guide](https://avala.ai/docs/sdks/typescript)
- [API Reference](https://avala.ai/docs/api-reference/overview)

## License

MIT - see [LICENSE](../../LICENSE) for details.
