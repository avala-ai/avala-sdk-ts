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

## Available Tools

| Tool Category | Description |
|---------------|-------------|
| Datasets | List and inspect annotation datasets |
| Projects | List and inspect projects |
| Exports | List, inspect, and create annotation exports |
| Fleet | Device management, recordings, events, alerts, rules |
| Agents | List and inspect automation agents |
| Webhooks | List and inspect webhook subscriptions |
| Storage | List and test storage configurations |
| Quality | Quality targets and consensus scoring |
| Annotation Issues | List and manage annotation issue data |
| Organizations | List organizations and members |
| Slices | List and inspect data slices |
| Stats | Get overview statistics for your account |
| **Workflows** | **Composite tools: fleet health overview, project quality summary, workspace overview, annotation pipeline creation** |
| Note | Write/delete tools (`create_*`, `delete_*`, `evaluate_quality`, `compute_consensus`) require `AVALA_MCP_ENABLE_MUTATIONS=true`. |

## Documentation

- [MCP Setup Guide](https://avala.ai/docs/integrations/mcp-setup)
- [TypeScript SDK Guide](https://avala.ai/docs/sdks/typescript)
- [API Reference](https://avala.ai/docs/api-reference/overview)

## License

MIT - see [LICENSE](../../LICENSE) for details.
