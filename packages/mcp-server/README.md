# @avala-ai/mcp-server

[![npm version](https://img.shields.io/npm/v/@avala-ai/mcp-server)](https://www.npmjs.com/package/@avala-ai/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for the [Avala API](https://avala.ai/docs). It lets agents such as Claude and Codex manage the Avala Physical AI data loop through the same tenant-safe APIs used by the platform.

## Connect to Avala's hosted MCP

Use `https://mcp.avala.ai/mcp` as a remote Streamable HTTP server in an
OAuth-capable MCP client. Sign in with your Avala account when prompted. Access
requires the corresponding Avala organization permissions and MCP grants; a
registry listing does not grant access. Staff tools require separate staff access.
Ask your Avala administrator if sign-in succeeds but the required tools are missing.

For VS Code, add this to `.vscode/mcp.json`, start the server, and complete sign-in:

```json
{
  "servers": {
    "avala": {
      "type": "http",
      "url": "https://mcp.avala.ai/mcp"
    }
  }
}
```

Begin with a read, such as listing the projects available to your account.
Tool availability follows your credential scopes and the deployed server version.
The initial registry listing describes read capabilities; it does not promise
proposal creation, approval, or execution. Never commit credentials to client
configuration files. See the [setup guide](https://avala.ai/docs/integrations/mcp-setup)
for additional clients and API-key configuration.

The hosted listing metadata lives in [`server.json`](./server.json). Its version
tracks registry metadata independently of the npm package and deployed image.

## Installation

```bash
npm install -g @avala-ai/mcp-server
```

Requires Node.js 20+.

### First-party operations skill

The source tree includes [avala-physical-ai-operations](./skills/avala-physical-ai-operations/SKILL.md)
and packages its complete directory under `skills/` in the MCP npm artifact.
It guides staff through bounded monitoring, exact-target inspection, independently
approved dispatch proposals, and separate execution/current-state verification.
It is not a customer QC approval skill and does not grant staff access or scopes.

**Release availability:** this is new package content, not present in the older
`0.7.4` npm artifact. Use a reviewed release that contains `skills/`, or test the
locally built SDK and MCP tarballs together. Do not infer publication from a
source checkout or assume the hosted MCP runs the same version.

After installing that MCP package into a local npm project, explicitly copy the
whole skill directory into your agent's skill location. For a repository-local
[Codex skill](https://learn.chatgpt.com/docs/build-skills), run from the project root:

```bash
test -f node_modules/@avala-ai/mcp-server/skills/avala-physical-ai-operations/SKILL.md &&
test ! -e .agents/skills/avala-physical-ai-operations &&
test ! -L .agents/skills/avala-physical-ai-operations &&
mkdir -p .agents/skills &&
cp -R node_modules/@avala-ai/mcp-server/skills/avala-physical-ai-operations .agents/skills/
```

The existence checks stop a reinstall from overwriting a customized skill.
Review and back up an existing copy before replacing it. Preserve `references/`
and `agents/`, not just `SKILL.md`. npm installation itself does not install an
agent skill or change client configuration. Other skill-capable clients can use
the same complete directory in their documented skill location.

Connect the hosted MCP separately as described above. Start with:
“Use $avala-physical-ai-operations to inspect the current dispatch state for this
exact batch; report evidence gaps and propose next steps without changing it.”
Inspect live tool metadata first: unavailable tools or scopes are a deployment
or access gap. Skill installation does not establish hosted readiness, human
approval, successful assignment, or the original customer QC acceptance flow.

For contributors, `skills/` is the canonical source and travels with the SDK
mirror. Catalog tests run in both repositories; monorepo tests additionally
check the local discovery copy. `bun run test:package` builds both packages,
installs their actual npm tarballs outside the workspace, copies the complete
skill into a disposable agent directory, and checks content and overwrite refusal.
It does not publish or call the Avala API.

To check an **already published** stable release from a source checkout, run
`bun run test:release X.Y.Z` from this package directory, replacing `X.Y.Z`
with the exact reviewed version. Tags, ranges, prereleases and omitted versions
are refused; the command never selects `latest`, bumps a version or publishes.
It downloads that SDK/MCP pair from the public npm registry, installs only the
MCP tarball into an isolated consumer (so npm must resolve its actual SDK edge),
then checks matching package/protocol versions, the complete skill and default
read catalog. Registry skill bytes are compared with that downloaded artifact,
not potentially newer checkout files. The output records version, artifact
integrities and actual Node version. npm lifecycle scripts are disabled, inherited
credentials are excluded, and only owned temporary files are removed.

A nonzero exit is a failed release check, including a missing version, a broken
dependency, missing skill or unavailable registry. In particular, the old `0.7.4`
artifact must not pass this operations-release check. Successful installation and
catalog discovery do not establish hosted authorization, provenance attestation,
API behavior or real Operations/customer-QC acceptance.

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
- **Proposal-backed dispatch**: use `list_workforce_assignment_candidates` (`workforce.write` OR `operations.proposal.read`), then `create_operation_proposal`, `evaluate_operation_proposal`, `request_operation_approval`, `get_operation_proposal`, `execute_approved_operation`, `verify_operation`, and `list_operation_events`. Each lifecycle tool declares its exact `operations.*` scope. Independent approval is available only through the returned same-origin Django admin `approval.reviewPath`; MCP cannot approve, and the requester cannot self-approve. Any credential with one of the five proposal scopes is proposal-only for writes, including credentials that also carry legacy write scopes. Direct assignment/cancellation tools have been removed. Execution queues a backend task and does not prove success; preserve UID/version and verify all current observations. Historical `verified` may coexist with current `changed`, and productive activity remains unmeasured. `reverse_operation` only records a BLOCKED child because progress observability is unavailable.
- **Read-first with an exact legacy action allowlist**: hosted MCP ignores `AVALA_MCP_ENABLE_MUTATIONS`. Its reviewed writes are `change_workforce_group_membership`, `change_workforce_batch_allocation`, `create_workforce_batch`, `set_workforce_batch_priority`, `set_workforce_batch_status`, `set_workforce_sequence_status`, visible only to a staff-privileged credential carrying `workforce.write` and none of the proposal scopes. Each action requires MCP elicitation, encrypted confirmation state bound to the exact tool, arguments, credential, expiry and idempotency key, exact expected state, and provider-side MCP audit provenance. Every successful response includes an immutable `operationEventUid`; preserve it and call `get_workforce_operation_event` before reporting the effect as verified. When a receipt UID is unknown, `list_workforce_operation_events` searches a bounded past window with explicit per-ledger storage coverage. Both receipt reads return only opaque targets, fixed before/after effects, provenance-presence booleans, and an explicit `complete`, `partial`, or `unavailable` verification status—never actor identity, reason/client text, raw changes, names, URLs, payloads, pay, rankings, or composite scores. Batch creation accepts only a bounded sequence-scoped unit plan, defaults to explicit allocated staffing, and always starts unavailable; the server derives coworker routes and rejects arbitrary URLs or configuration. Sequence inspection returns only opaque IDs, workflow state, observation tokens, and authorized next edges—never sequence contents or workflow definitions. Current dispatch health reports only present released-to-claimable state and includes an exact receipt for its sampled server observation; an unavailable receipt leaves the live snapshot usable but prevents claiming it was durably recorded. Historical dispatch observations expose those recorded states over bounded windows without pretending sparse, read-triggered samples are continuous telemetry; absent rows do not prove health or unchanged state, and current context is not historical context. Historical dispatch outcomes separately report first database-observed release, first recorded anonymous server-generated queue visibility, and earliest recorded post-release claim, with explicit release and queue-storage gaps. Queue evidence proves neither client receipt nor earliest possible visibility, and historical blocker attribution is never inferred from current state. The exact-journey training-cohort read joins current stored enrollment/completion and latest durable completed-step evidence to current qualifying production-result state. Learning enrollment, progress, and practice data remains authoritative at `learning.avala.ai` (Vercel/Supabase); Django only supplies the bounded join to production evidence. For returned members without observed current qualifying output, the same read includes per-exercise current-curriculum outcome counts and positive load-failure diagnostics. Failure without pass is unresolved recorded evidence—not causal dropoff, actual stall, skill, intent, or ranking—and absence of a load-failure row does not prove success. Aggregate stable exercise step UIDs across every unchanged cursor page before any global practice claim. The read explicitly excludes deleted/overwritten enrollment and practice-row history, historical payouts, sequence results, prompts, answers, scores, raw payloads, and browser/build labels. Its page summaries are never presented as global unless the provider marks reconciliation complete. The exact-coworker journey read joins account readiness, Learning, task access, and non-practice production only for a caller-supplied coworker UID; it exposes a safe label and evidence-backed diagnosis while excluding contacts, provider identities, KYC, pay, and customer payloads, and it propagates joined-provider failures instead of manufacturing zeroes. Unit inspection never exposes coworker identity; write-scoped group discovery returns stable group UIDs, internal labels, and aggregate membership readiness without member rows or live-capacity claims. The separate member roster returns only opaque coworker UIDs, safe first-name/fallback labels, and active, approved, and active-work booleans—never contact/profile data, permissions, pay, performance, customer payloads, or work details. Exact-batch activity monitoring returns opaque coworker IDs plus current assignment state and raw bounded activity only; it never exposes identity fields, work details, rankings, rates, or a composite performance score. `change_workforce_group_membership` requires every exact field from `preview_workforce_group_membership_impact`, two explicit global/capability acknowledgements, and separate human approval; it refuses known no-ops and removals blocked by active target-group work. Global group membership may affect work eligibility and platform capabilities beyond the listed production lines. Batch allocation is the narrower scheduling control: the staffing roster and impact preview expose only opaque IDs, readiness, fixed counts, and raw organization-scoped outcomes, and `change_workforce_batch_allocation` never changes global group qualification. Candidate discovery never returns a ranking, composite score, profile, customer payload, or pay data.
- **Session and station monitoring**: `get_workforce_session_monitoring` and `get_workforce_station_monitoring` require staff access plus `workforce.read`. Session monitoring accepts `endedFrom`/`endedBefore` as a past half-open window of at most 31 days and counts endings by `ended_at`; missing historical end times stay unknown. Its definition counts span all projects and sample at most 1000 newest-created rows per status; false `statusCountsComplete` means lower bounds, and window completeness requires both terminal statuses complete. Station monitoring counts only retained SessionTask links: recovery can delete links, historical coverage is incomplete, and cross-station counts are not additive. Station reads sample at most 1000 links; false `countsComplete` means lower bounds, and `unknownStatusTaskLinks` preserves sampled unknown statuses. Both use bounded UID pages (`limit` 1–10, default 5; preserve filters with `nextCursor`). Neither establishes completed annotation throughput, upload/acceptance, billing, safe reassignment, Redis queue visibility, or infrastructure health.
- **Coworker queue-output evidence**: `get_workforce_coworker_reliability` is a pseudonymous, `workforce.write`-scoped staff read. It separates sampled no-work observations from sampled work-available/no-output observations, refuses incomplete storage windows, and explicitly does not claim complete attendance, scheduled availability, intent, or deliberate idleness.
- **Asset handles**: reads return short-lived opaque handles instead of provider-signed media and export URLs. `resolve_asset_handle` uses MCP elicitation, verifies a short-lived server-issued confirmation challenge bound to the exact handle, then re-fetches the resource with the current credential. Unsupported, declined, forged, or cross-handle replayed confirmation releases no URL.
- Browser `Origin` validation applies to `/mcp`; public liveness and discovery routes contain no credentialed functionality.

Hosted operators must configure `AVALA_MCP_INTERNAL_CLIENT_SECRET`, `AVALA_MCP_OAUTH_RESOURCE`, `AVALA_MCP_OAUTH_ISSUER`, `AVALA_MCP_OAUTH_API_AUDIENCE`, `AVALA_MCP_OAUTH_CLIENT_ID`, `AVALA_MCP_OAUTH_CLIENT_SECRET`, and the space-separated `AVALA_MCP_OAUTH_SCOPES`. For proposal-backed staff operations, advertise `mcp.staff_access`, `workforce.read`, `operations.proposal.read`, `operations.proposal.create`, `operations.approval.request`, `operations.execution.request`, and `operations.verification.read`. Auth0 still requires the admin-assigned role and Django still requires `is_staff=True`; advertising scopes never grants them to customers. Omitting a required scope makes its tools undiscoverable or causes 403 responses. `workforce.read` supplies bounded production monitoring and journey evidence; `operations.proposal.read` also permits assignment-candidate discovery without `workforce.write`.

Include `workforce.write` only for deployments supporting separate legacy staff credentials that need immutable operation receipts, internal group discovery, group and batch staffing rosters, exact-batch activity, impact previews, or the six reviewed group-membership, batch-allocation, batch-creation, batch-priority, batch-lifecycle and sequence-lifecycle actions. Proposal-bearing credentials cannot use those legacy writes even when they also carry `workforce.write`. Direct assignment/deassignment tools are removed. `PORT`, `AVALA_BASE_URL`, and comma-separated `ALLOWED_ORIGINS` remain optional. Confidential values belong in the deployment secret store, never environment templates or source control.

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

For read-only application readiness, run `python scripts/mcp_production_readiness.py --phase proposal-readiness --json` from the monorepo with `AVALA_MCP_PROPOSAL_BEARER_TOKEN` and `AVALA_MCP_CANARY_OPERATION_PROPOSAL_UID` set through the normal environment. Use a staff proposal credential with `workforce.read` and all five proposal scopes, plus an existing executed proposal. The check inspects all eight lifecycle tools and calls only the three GET tools; it does not create, approve, execute or reverse anything and does not establish infrastructure/deployment readiness.

Proposal responses preserve `snapshotCanonicalJson`, the provider's exact frozen hash input. SHA-256 over its untouched UTF-8 bytes equals `snapshotHash`; do not reserialize the typed snapshot to reproduce the digest. The MCP boundary checks those bytes and their exact correspondence with the finite typed snapshot before returning them.

### Recorded earnings and billing

Staff credentials with explicitly granted `billing.read` can call
`get_billing_coworker_earnings` and `list_billing_organizations`. Workforce grants
do not include financial access. Earnings select complete recorded payout periods
by their end timestamp in a past half-open window of at most 31 days. Preserve
currency and decimal-string precision; time is milliseconds. These reads do not
calculate pending earnings, verify settlement, expose invoices or attribute costs
to work batches. Organization status is stored data, not a live provider check.
