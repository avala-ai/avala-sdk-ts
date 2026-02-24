# Avala TypeScript SDK + MCP Server

[![npm: @avala-ai/sdk](https://img.shields.io/npm/v/@avala-ai/sdk)](https://www.npmjs.com/package/@avala-ai/sdk)
[![npm: @avala-ai/mcp-server](https://img.shields.io/npm/v/@avala-ai/mcp-server)](https://www.npmjs.com/package/@avala-ai/mcp-server)
[![CI](https://github.com/avala-ai/avala-sdk-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/avala-ai/avala-sdk-ts/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Official TypeScript SDK and MCP server for the [Avala API](https://docs.avala.ai). Build and manage ML annotation datasets, projects, exports, and tasks programmatically.

> **Note:** This repository is a read-only mirror. To report bugs or request features, please [open an issue](https://github.com/avala-ai/avala-sdk-ts/issues). See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| [`@avala-ai/sdk`](./packages/sdk) | 0.3.0 | TypeScript SDK for the Avala API |
| [`@avala-ai/mcp-server`](./packages/mcp-server) | 0.3.0 | MCP server for AI assistant integrations |

## SDK Quick Start

```bash
npm install @avala-ai/sdk
```

```typescript
import Avala from "@avala-ai/sdk";

const avala = new Avala();  // reads AVALA_API_KEY env var

// List datasets
const page = await avala.datasets.list({ limit: 10 });
page.items.forEach(d => console.log(d.uid, d.name));

// Get a specific dataset
const dataset = await avala.datasets.get("dataset-uid");

// Create an export
const exp = await avala.exports.create({ project: "project-uid" });
console.log(exp.uid, exp.status);

// List tasks with filters
const tasks = await avala.tasks.list({ project: "project-uid", status: "completed" });
```

### Authentication

The client reads your API key from the `AVALA_API_KEY` environment variable by default:

```bash
export AVALA_API_KEY="avk_your_api_key"
```

Or pass it explicitly:

```typescript
const avala = new Avala({ apiKey: "avk_your_api_key" });
```

### Pagination

All `.list()` methods return a `CursorPage` with `.items`, `.hasMore`, and `.nextCursor`:

```typescript
let page = await avala.datasets.list({ limit: 20 });

for (const dataset of page.items) {
  console.log(dataset.name);
}

if (page.hasMore) {
  const nextPage = await avala.datasets.list({ cursor: page.nextCursor });
}
```

### Error Handling

```typescript
import Avala, { AvalaError, NotFoundError, RateLimitError } from "@avala-ai/sdk";

try {
  const dataset = await avala.datasets.get("nonexistent");
} catch (e) {
  if (e instanceof NotFoundError) {
    console.log("Dataset not found");
  } else if (e instanceof RateLimitError) {
    console.log("Rate limited");
  } else if (e instanceof AvalaError) {
    console.log(`API error: ${e.message}`);
  }
}
```

### Available Resources

| Resource | Methods | Description |
|----------|---------|-------------|
| `avala.datasets` | `list()`, `get(uid)` | Browse and inspect datasets |
| `avala.projects` | `list()`, `get(uid)` | Browse and inspect projects |
| `avala.exports` | `list()`, `get(uid)`, `create()` | Create and manage annotation exports |
| `avala.tasks` | `list()`, `get(uid)` | Browse tasks with project/status filters |
| `avala.storageConfigs` | `list()`, `create()`, `test()`, `delete()` | Manage cloud storage connections |

## MCP Server

The `@avala-ai/mcp-server` package provides an MCP server that lets AI assistants (Claude, etc.) interact with your Avala data.

```bash
npm install -g @avala-ai/mcp-server
avala-mcp-server
```

See [MCP Setup Guide](https://docs.avala.ai/integrations/mcp-setup) for configuration details.

## Development

This is a pnpm monorepo. To get started:

```bash
pnpm install
pnpm -r build
pnpm -r test
```

## Documentation

- [TypeScript SDK Guide](https://docs.avala.ai/sdks/typescript)
- [MCP Setup Guide](https://docs.avala.ai/integrations/mcp-setup)
- [API Reference](https://docs.avala.ai/api-reference/overview)
- [Quickstart](https://docs.avala.ai/getting-started/quickstart)
- [Examples](https://docs.avala.ai/resources/examples)

## License

MIT - see [LICENSE](LICENSE) for details.
