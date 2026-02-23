# @avala-ai/sdk

[![npm version](https://img.shields.io/npm/v/@avala-ai/sdk)](https://www.npmjs.com/package/@avala-ai/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Official TypeScript SDK for the [Avala API](https://docs.avala.ai). Build and manage ML annotation datasets, projects, exports, and tasks programmatically.

## Installation

```bash
npm install @avala-ai/sdk
```

Requires Node.js 18+.

## Quick Start

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

## Authentication

The client reads your API key from the `AVALA_API_KEY` environment variable by default:

```bash
export AVALA_API_KEY="avk_your_api_key"
```

Or pass it explicitly:

```typescript
const avala = new Avala({ apiKey: "avk_your_api_key" });
```

## Pagination

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

## Error Handling

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

## Available Resources

| Resource | Methods | Description |
|----------|---------|-------------|
| `avala.datasets` | `list()`, `get(uid)` | Browse and inspect datasets |
| `avala.projects` | `list()`, `get(uid)` | Browse and inspect projects |
| `avala.exports` | `list()`, `get(uid)`, `create()` | Create and manage annotation exports |
| `avala.tasks` | `list()`, `get(uid)` | Browse tasks with project/status filters |
| `avala.storageConfigs` | `list()`, `create()`, `test()`, `delete()` | Manage cloud storage connections |
| `avala.agents` | `list()`, `get()`, `create()`, `update()`, `delete()`, `listExecutions()`, `test()` | Manage automation agents |
| `avala.inferenceProviders` | `list()`, `get()`, `create()`, `update()`, `delete()`, `test()` | Manage inference providers |
| `avala.autoLabelJobs` | `list()`, `get()`, `create()`, `cancel()` | Batch auto-labeling jobs |
| `avala.qualityTargets` | `list()`, `get()`, `create()`, `update()`, `delete()`, `evaluate()` | Project quality targets |
| `avala.consensus` | `getSummary()`, `listScores()`, `compute()`, `getConfig()`, `updateConfig()` | Consensus scoring |
| `avala.webhooks` | `list()`, `get()`, `create()`, `update()`, `delete()`, `test()` | Manage webhook subscriptions |
| `avala.webhookDeliveries` | `list()`, `get()` | Inspect webhook delivery logs |

## Documentation

- [TypeScript SDK Guide](https://docs.avala.ai/sdks/typescript)
- [API Reference](https://docs.avala.ai/api-reference/overview)
- [Quickstart](https://docs.avala.ai/getting-started/quickstart)

## License

MIT - see [LICENSE](../../LICENSE) for details.
