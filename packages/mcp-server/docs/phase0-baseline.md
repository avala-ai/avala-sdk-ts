# Phase 0 baseline — Avala MCP server

Date: 2026-08-28. Regenerate the table with `bun scripts/tool-inventory.ts`.

Scope of this document: the orientation pass required before any change
(standing brief §4). It records the tool surface, the two read-path defects whose
root cause is now established, and the reason payload measurement is deferred to
the eval harness rather than done by hand.

## 1. Surface

64 tools — 47 read, 17 mutation. Full table: [`tool-inventory.md`](tool-inventory.md).

Registration splits two ways, and the split is the single most useful fact in
this document:

| Path | Tools | Sanitized | `annotations` | `outputSchema` |
|---|---|---|---|---|
| Declarative catalog (`registerReadCatalogTool`) | 36 | yes (key-name only, see §2) | yes | yes |
| Hand-written `server.registerTool` | 28 | **24 of them: no** | no | no |

24 tools serialize the upstream response with a bare `JSON.stringify` and reach
no redaction of any kind. Exactly one hand-written tool (`fleet_get_device`) uses
`safeStringify`. 23 tools declare no `avala.ai/required-scope`.

The unsanitized 24 include every tool the brief flags in §6.2 and §6.3:
`get_frame`, `get_calibration`, `get_project_quality_summary`,
`get_workspace_overview`, `get_fleet_health`, `list_projects`, `get_project`.

## 2. Defect: the redactor cannot see the credentials it is named for

`src/redact.ts` matches on **key names**. It force-redacts a value whose key is
`apiKey`, `awsAccessKeyId`, `secret`, and so on. That is a real control for
config blobs, and it is the wrong shape for the leak in brief §6.2, which is a
credential in the *value* of a benign key.

Reproduced directly against the shipped module:

```
input : { logo: "https://…/logo.png?AWSAccessKeyId=AKIA…&Signature=…&x-amz-security-token=Fwo…",
          exportSnippet: { annotator: "Jane Doe", reviewerEmail: "…@avala.ai", username: "+2547…" } }
output: unchanged, byte for byte
```

`AWSAccessKeyId` *is* in the deny-list — as a key name. Here it is a query
parameter inside a string, so key-name matching cannot reach it. Every signed S3
URL therefore survives redaction on all 36 catalog tools as well as the 24
unsanitized ones, and no personal field is covered at all: `annotator`,
`reviewerEmail` and a phone-number `username` are not credentials by key name and
were never in scope for this module.

So there are two independent leak mechanisms, and fixing either alone leaves the
hard gate open:

1. **No redaction at all** on 24 tools.
2. **Value-blind redaction** on the 36 that do redact.

The fix is a value-level scrubber (URL query-parameter deny-list + secret
patterns) plus a personal-data tier applied at the serialization boundary that
*every* tool shares — not another key added to the list. Brief §12 makes this a
build-failing gate; §6.2's opaque-handle mechanism is the durable form.

## 3. Defect: `list_projects` points at a staff-only route

Brief §6.1 asks whether the 403 is token scope, a permission-check bug, or a
service-account mapping issue. It is none of those. It is a tool-to-route
mismatch, and the token is behaving correctly.

| Route | View | Permission |
|---|---|---|
| `GET /api/v1/projects/` ← **what the MCP calls** | `ProjectViewSet` | `[IsStaffAndNotApiKeyOrStaffApiKey]` |
| `GET /api/v1/users/me/projects/` | `UserProjectViewSet` | `(IsOwner & IsCustomer) \| IsStaffAndNotApiKeyOrStaffApiKey` |

`ProjectViewSet` is staff-only by design, and `IsStaffAndNotApiKeyOrStaffApiKey`
additionally refuses a staff member's ordinary data-plane key (pentest finding
`apikey/s3-2`). A customer credential can never pass it, and neither can the
MCP's. Meanwhile `list_projects` is advertised as a customer tool: scope
`projects.read`, toolset `projects`. The customer-visible project surface is
`UserProjectViewSet`, which the MCP never calls.

This also explains the cascade in §6.1 and §6.3 without any further cause:
`get_project_quality_summary` and `get_workspace_overview` key on a project
fetch, that fetch 403s, and both return a success-shaped body with an empty
array.

**Do not fix this by widening `ProjectViewSet`.** The reflex fix — grant the
credential `projects.read` on that route, or relax the permission class — would
expose every tenant's projects, because `accessible_projects` has no
`_scoped(staff_bypass=…)` variant yet (`.claude/rules/security.md`, known gap
(b)). The fix belongs in the MCP/SDK: point the customer project tools at the
user-scoped route, and if a global project listing is genuinely wanted, register
it as a *staff* tool, which is permissible precisely because `ProjectViewSet`
composes the strong staff permission.

**Status 2026-08-29.** `list_projects` / `get_project` now call `listMine` /
`getMine` (#15579). The same staff `projects.list` leftover lived in
`get_workspace_stats` (this lane) and still lives in `get_workspace_overview`
(`workflows.ts`, other lane — do not edit). Capture campaign and submission
tools are not this defect: they hit dataset-nested routes
(`/datasets/{uid}/capture-campaigns/`, `/datasets/{uid}/capture-submissions/`),
not `ProjectViewSet`. Quality tools take a `projectUid` and call nested
`/projects/{projectUid}/…` routes, which is a different permission question
than the staff list.

## 4. Payload measurement is deferred to the harness, deliberately

Brief §4.2 asks for per-tool response sizes now. Doing that by hand means calling
`get_frame` and `list_datasets` and having the result rendered into an agent
transcript — which is the exact disclosure §6.2 exists to stop, and this
transcript is as much a sink as any other. Measuring "how much credential-bearing
JSON does this return" by pasting it somewhere is self-defeating.

The measurement therefore lands in the Phase 1 harness, which records responses
to cassettes, scrubs them on write, and reports **size only**. That also makes
the number reproducible and diffable across iterations, which a one-off manual
reading would not be. The ordering input Phase 2 actually needs — which tools are
worst — is already available from §1: the unsanitized hand-written 24 are also
the ones with no `detail` parameter and no pagination contract.

## 5. What Phase 1 starts from

- Fix order stands as the brief sets it: §6.1 first (it unblocks the QC and
  capture surfaces, and the diagnosis above makes it a small, safe change), then
  §6.2 as a build-failing gate.
- The eval tasks are written from the capability docs and real questions, not
  from `tool-inventory.md` (brief §4.4). The inventory is for Phase 2 and Phase 4
  triage; reading it while writing tasks would produce tasks the current surface
  happens to pass.
