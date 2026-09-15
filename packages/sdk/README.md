# @avala-ai/sdk

[![npm version](https://img.shields.io/npm/v/@avala-ai/sdk)](https://www.npmjs.com/package/@avala-ai/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Official TypeScript SDK for the [Avala API](https://avala.ai/docs). Build and manage ML annotation datasets, projects, exports, and tasks programmatically.

## Installation

```bash
npm install @avala-ai/sdk
```

Requires Node.js 18+.

## Quick Start

```typescript
import Avala from "@avala-ai/sdk";  // or: import { Client } from "@avala-ai/sdk"

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

Delegated services may instead pass an OAuth access token issued specifically
for the Avala API:

```typescript
const avala = new Avala({ accessToken: apiAudienceAccessToken });
```

`apiKey` and `accessToken` are mutually exclusive. Do not pass an ID token or a
token issued for another resource (for example, an MCP-server token); exchange
it for an Avala API-audience token first.

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
| `avala.permissions` | `get()` | Discover the current credential's scopes, capabilities, and toolsets |
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
| `avala.customerQc` | `inspectContext(target)` | Default-off pilot: read-only workflow metadata, never approval authority |
| `avala.webhooks` | `list()`, `get()`, `create()`, `update()`, `delete()`, `test()` | Manage webhook subscriptions |
| `avala.webhookDeliveries` | `list()`, `get()` | Inspect webhook delivery logs |

## Customer QC inspection pilot

`avala.customerQc.inspectContext({ organizationUid, datasetUid, sequenceUid, deliverableId: "cuboids" })`
reads the enrolled customer's workflow context. Supply canonical lowercase UUIDs,
an API credential for a current nonstaff organization editor, and both
`datasets.read` and `qc.read` scopes when using delegated credentials. Pilot
enrollment remains a separate server-side prerequisite; this method does not enable it.

The result has `evidenceKind: "workflow_metadata_only"`, `decisionReady: false`
and explicit `blockers`. Available decisions are configured transitions, not
executable agent decisions. `contextSha256` is metadata consistency information,
not an annotation revision, signature or approval grant. The client rejects
unsupported/malformed response contracts and mismatched targets, preserves
server blockers, and does not fall back to legacy write routes after denial.
No customer-QC proposal, approval or hosted MCP tool is added by this SDK method.

## Documentation

- [TypeScript SDK Guide](https://avala.ai/docs/sdks/typescript)
- [API Reference](https://avala.ai/docs/api-reference/overview)
- [Quickstart](https://avala.ai/docs/getting-started/quickstart)

## License

MIT - see [LICENSE](../../LICENSE) for details.
