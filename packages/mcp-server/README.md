# @avala-ai/mcp-server

[![npm version](https://img.shields.io/npm/v/@avala-ai/mcp-server)](https://www.npmjs.com/package/@avala-ai/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for the [Avala API](https://avala.ai/docs). Lets AI assistants (Claude, etc.) interact with your Avala annotation data.

## Installation

```bash
npm install -g @avala-ai/mcp-server
```

Requires Node.js 18+.

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

The package also ships a stateless [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http) entry, used by Avala's hosted deployment:

```bash
node dist/http.js
```

- `POST /mcp` — the MCP endpoint. Every request must carry its own credential: `X-Avala-Api-Key: <key>`, or `Authorization: Bearer <key>` (40-hex Avala API key). The key is forwarded on that request's REST calls only; authorization happens entirely in the Avala REST API.
- `GET /healthz` — unauthenticated liveness probe.
- **Read-only**: the hosted transport always serves the read-only catalog. Write/delete tools are stdio-only until server-side scope enforcement and a confirmation flow exist; `AVALA_MCP_ENABLE_MUTATIONS` is ignored here by design.
- Environment: `PORT` (default `8080`), `AVALA_BASE_URL` (override the REST base URL), `ALLOWED_ORIGINS` (comma-separated browser origins; default empty — requests carrying any `Origin` header are rejected, per the MCP spec's DNS-rebinding defense).

Unlike stdio mode, no `AVALA_API_KEY` environment variable is read — the server is multi-tenant, one credential per request.

## Available Tools

| Tool Category | Description |
|---------------|-------------|
| Datasets | List and inspect datasets, sequences, frames, calibration, and ingest health |
| Projects | List and inspect projects |
| Exports | List, inspect, and create annotation exports |
| Fleet | Device management, recordings, events, alerts, rules |
| Agents | List and inspect automation agents |
| Webhooks | List and inspect webhook subscriptions |
| Storage | List storage configurations |
| Quality | Quality targets and consensus scoring |
| Annotation Issues | List and manage annotation issue data |
| Organizations | List organizations and members |
| Slices | List and inspect data slices |
| Stats | Get overview statistics for your account |
| **Workflows** | **Composite tools: fleet health overview, project quality summary, workspace overview, annotation pipeline creation** |
| Note | Write/delete tools (`create_*`, `delete_*`, `test_storage_config`, `evaluate_quality`, `compute_consensus`) require `AVALA_MCP_ENABLE_MUTATIONS=true`. |

## Documentation

- [MCP Setup Guide](https://avala.ai/docs/integrations/mcp-setup)
- [TypeScript SDK Guide](https://avala.ai/docs/sdks/typescript)
- [API Reference](https://avala.ai/docs/api-reference/overview)

## License

MIT - see [LICENSE](../../LICENSE) for details.
