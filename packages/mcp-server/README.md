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

Local stdio MCP exposes only reads unless you explicitly enable its legacy mutation catalog:

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
- **Read-first with an exact action allowlist**: hosted MCP ignores `AVALA_MCP_ENABLE_MUTATIONS`. Its reviewed writes are `change_workforce_group_membership`, `change_workforce_batch_allocation`, `create_workforce_batch`, `set_workforce_batch_priority`, `set_workforce_batch_status`, `set_workforce_sequence_status`, `assign_workforce_work_unit`, and `deassign_workforce_work_unit`, visible only to a staff-privileged credential carrying `workforce.write`. Each action requires MCP elicitation, encrypted confirmation state bound to the exact tool, arguments, credential, expiry and idempotency key, exact expected state, and provider-side MCP audit provenance. Every successful response includes an immutable `operationEventUid`; preserve it and call `get_workforce_operation_event` before reporting the effect as verified. When a receipt UID is unknown, `list_workforce_operation_events` searches a bounded past window with explicit per-ledger storage coverage. Both receipt reads return only opaque targets, fixed before/after effects, provenance-presence booleans, and an explicit `complete`, `partial`, or `unavailable` verification status—never actor identity, reason/client text, raw changes, names, URLs, payloads, pay, rankings, or composite scores. Batch creation accepts only a bounded sequence-scoped unit plan, defaults to explicit allocated staffing, and always starts unavailable; the server derives coworker routes and rejects arbitrary URLs or configuration. Sequence inspection returns only opaque IDs, workflow state, observation tokens, and authorized next edges—never sequence contents or workflow definitions. Current dispatch health reports only present released-to-claimable state and includes an exact receipt for its sampled server observation; an unavailable receipt leaves the live snapshot usable but prevents claiming it was durably recorded. Historical dispatch observations expose those recorded states over bounded windows without pretending sparse, read-triggered samples are continuous telemetry; absent rows do not prove health or unchanged state, and current context is not historical context. Historical dispatch outcomes separately report first database-observed release, first recorded anonymous server-generated queue visibility, and earliest recorded post-release claim, with explicit release and queue-storage gaps. Queue evidence proves neither client receipt nor earliest possible visibility, and historical blocker attribution is never inferred from current state. The exact-journey training-cohort read joins current stored enrollment/completion and latest durable completed-step evidence to current qualifying production-result state, while explicitly excluding deleted/overwritten enrollment history, historical payouts, sequence results, and any claim that a last progress point proves an actual stall. Its page summaries are never presented as global unless the provider marks reconciliation complete. The exact-coworker journey read joins account readiness, Learning, task access, and non-practice production only for a caller-supplied coworker UID; it exposes a safe label and evidence-backed diagnosis while excluding contacts, provider identities, KYC, pay, and customer payloads, and it propagates joined-provider failures instead of manufacturing zeroes. Unit inspection and deassignment never expose coworker identity; write-scoped group discovery returns stable group UIDs, internal labels, and aggregate membership readiness without member rows or live-capacity claims. The separate member roster returns only opaque coworker UIDs, safe first-name/fallback labels, and active, approved, and active-work booleans—never contact/profile data, permissions, pay, performance, customer payloads, or work details. Exact-batch activity monitoring returns opaque coworker IDs plus current assignment state and raw bounded activity only; it never exposes identity fields, work details, rankings, rates, or a composite performance score. `change_workforce_group_membership` requires every exact field from `preview_workforce_group_membership_impact`, two explicit global/capability acknowledgements, and separate human approval; it refuses known no-ops and removals blocked by active target-group work. Global group membership may affect work eligibility and platform capabilities beyond the listed production lines. Batch allocation is the narrower scheduling control: the staffing roster and impact preview expose only opaque IDs, readiness, fixed counts, and raw organization-scoped outcomes, and `change_workforce_batch_allocation` never changes global group qualification. Candidate discovery never returns a ranking, composite score, profile, customer payload, or pay data.
- **Coworker queue-output evidence**: `get_workforce_coworker_reliability` is a pseudonymous, `workforce.write`-scoped staff read. It separates sampled no-work observations from sampled work-available/no-output observations, refuses incomplete storage windows, and explicitly does not claim complete attendance, scheduled availability, intent, or deliberate idleness.
- **Asset handles**: reads return short-lived opaque handles instead of provider-signed media and export URLs. `resolve_asset_handle` uses MCP elicitation, verifies a short-lived server-issued confirmation challenge bound to the exact handle, then re-fetches the resource with the current credential. Unsupported, declined, forged, or cross-handle replayed confirmation releases no URL.
- Browser `Origin` validation applies to `/mcp`; public liveness and discovery routes contain no credentialed functionality.

Hosted operators must configure `AVALA_MCP_INTERNAL_CLIENT_SECRET`, `AVALA_MCP_OAUTH_RESOURCE`, `AVALA_MCP_OAUTH_ISSUER`, `AVALA_MCP_OAUTH_API_AUDIENCE`, `AVALA_MCP_OAUTH_CLIENT_ID`, `AVALA_MCP_OAUTH_CLIENT_SECRET`, and the space-separated `AVALA_MCP_OAUTH_SCOPES`. A staff-operations deployment must advertise `mcp.staff_access` and `workforce.read`; Auth0 still requires the admin-assigned role and Django still requires `is_staff=True`, so advertising the scopes never grants them to customers. Without both, OBO strips staff privilege or workforce monitoring and the corresponding tools return 403 or remain undiscoverable. `workforce.read` exposes the privacy-bounded production overview, current dispatch health, sparse historical dispatch observations, historical dispatch outcomes, exact-journey training-cohort evidence, exact-coworker journey, batch inventory and attention, batch units, and sequence status needed to monitor Physical AI data production lines. Include `workforce.write` only for deployments whose staff operators should search and verify immutable operation receipts, discover internal workforce groups, inspect privacy-bounded group and batch staffing rosters, monitor exact-batch coworker activity, preview and change global group membership or exact-batch allocation, discover opaque assignment candidates, and see the reviewed batch-creation, batch-priority, batch-lifecycle, sequence-lifecycle, assignment, and deassignment actions. `PORT`, `AVALA_BASE_URL`, and the comma-separated `ALLOWED_ORIGINS` remain optional. Confidential values belong in the deployment secret store, never environment templates or source control.

The pseudonymous queue-output comparison also requires `workforce.write`; omit that scope when a deployment should not expose person-level operational evidence.

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
| Assets            | Resolve an opaque media or export handle after confirmation and a current-credential access check                                                     |
| Stats             | Get overview statistics for your account                                                                                                               |
| **Workflows**     | **Composite tools: fleet health overview, project quality summary, workspace overview, annotation pipeline creation**                                  |
| Staff             | Avala staff only: SQL sandbox proxies, aggregate production monitoring, exact-journey training-cohort evidence, current and sampled historical dispatch evidence, release → queue exposure → claim outcomes, bounded production-line inventory, pseudonymous queue-output evidence, immutable operation-receipt verification, group/member readiness, batch/unit attention, signal-backed opaque assignment candidates, and confirmed queue controls |
| Note              | Local stdio legacy writes (`create_*`, `delete_*`, `test_storage_config`, `evaluate_quality`, `compute_consensus`) require `AVALA_MCP_ENABLE_MUTATIONS=true`; hosted MCP ignores that flag. |

## Documentation

- [MCP Setup Guide](https://avala.ai/docs/integrations/mcp-setup)
- [TypeScript SDK Guide](https://avala.ai/docs/sdks/typescript)
- [API Reference](https://avala.ai/docs/api-reference/overview)

## License

MIT - see [LICENSE](../../LICENSE) for details.
