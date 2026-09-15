---
name: avala-physical-ai-operations
description: Operate Avala Physical AI labeling production lines through the staff MCP. Use for monitoring work batches, sessions, production stations, dispatch, annotation progress, coworker evidence, training cohorts, assignments, allocations, group membership, sequence lifecycle, recorded earnings, billing status, or reviewed workforce interventions. Do not use for HR decisions or unrelated customer dataset analysis.
---

# Avala Physical AI Operations

Use Avala's product MCP to monitor and control the human-in-the-loop segment of
the Physical AI data loop. Keep every conclusion tied to the evidence boundary
returned by the tool. Dispatch assignment uses a durable Django proposal with
independent human approval and current verification. Other reviewed workforce
actions retain their dedicated preview, confirmation and stale-state controls.

This skill guides tool choice; it grants no permissions. Read-only inspection is
safe to begin when requested. An assignment or other domain change requires
clear user intent and approval from the authority advertised by the live tool.
Never bypass, simulate, or weaken that approval. Proposal creation and evaluation do not authorize an
assignment; only the separate human Django review can approve execution.

## Start with the live surface

Inspect the connected Avala MCP tools before planning. The deployed server, the
checked-out source, and the published package can be at different revisions.
Treat the live tool descriptions and required scopes as authoritative for what
can execute now. If a documented tool is missing, report the deployment gap; do
not substitute an arbitrary SQL write or pretend the action occurred.

Staff workforce tools require a staff-privileged identity and the exact scope
advertised by each tool. Most operational reads use `workforce.read`. Recorded earnings and organization
billing require the separate `billing.read` scope; workforce access does not
authorize financial reads.
Roster/activity, sampled queue-output, impact-preview, receipt and legacy
mutation tools use `workforce.write`; privacy-bounded journey and training reads
remain on `workforce.read`. Exact assignment candidates accept `workforce.write`
OR `operations.proposal.read`. The proposal lifecycle uses the five narrow
`operations.*` scopes in the tool map and does not require `workforce.write`.
Any credential carrying a proposal scope is restricted to proposal lifecycle
writes, even if it also carries legacy write scopes. Scope possession does not
replace staff privilege; inspect the live metadata before calling a tool.

Read [references/tool-map.md](references/tool-map.md) when choosing tools or
planning a mutation. It maps the complete workforce surface and the safe
read-plan-preview-approve-verify sequences.

## Establish the production-line scope

Before interpreting or changing anything, resolve the narrowest available set
of opaque identifiers: organization, project, dataset, sequence, batch, work
unit, and coworker as applicable. Preserve these IDs between reads. Do not infer
that similarly named resources belong to the same customer or project, and do
not widen an exact-batch request to all organizations.

If the operator supplied a name but the privacy-bounded surface returns only
opaque IDs, ask for or retrieve the reviewed ID through an authorized tool. Do
not use contact details, KYC, pay, customer payloads, or unrestricted SQL to
resolve a person.

## Monitor before intervening

Build an evidence chain from broad to exact:

1. Read the aggregate operations overview or filtered batch inventory.
2. Inspect the exact batch, unit, sequence, or coworker signal relevant to the
   question.
3. Follow every `nextCursor` with unchanged filters before making a global or
   population-wide statement.
4. State the observation time, window boundary, page/global scope, storage
   coverage, and unavailable evidence alongside any count.
5. Propose the smallest operational change supported by the evidence. Do not
   mutate merely because a blocker or candidate appears.

Preserve these distinctions:

- Current dispatch health is a snapshot. Historical observations are sparse,
  read-triggered samples. Dispatch outcomes cover recorded release, anonymous
  queue visibility, and claims; none proves continuous visibility or client
  receipt.
- Queue-output evidence is sampled and does not prove attendance, scheduled
  availability, intent, or deliberate idleness. Raw activity counts are signals,
  not rankings or performance scores.
- Session monitoring counts definition-level state across all projects and
  terminal sessions by `ended_at` in a past half-open window. Unknown end times
  stay outside window counts. Each status samples at most 1000 newest-created
  rows: false `statusCountsComplete` makes its counts lower bounds. Complete window
  counts require both terminal statuses complete; a truncated zero is unknown.
  Finished annotation/capture sessions do not prove completed tasks, uploaded or
  accepted data, or billable work.
- Station monitoring counts retained links for a project/session-definition
  pair, not a physical capture rig. At most 1000 links are sampled; false
  `countsComplete` means lower bounds. `unknownStatusTaskLinks` preserves links
  outside known statuses. Even a complete sample has incomplete history.
  Recovery can delete links, so missing links are not proof of no work and
  historical station throughput is unsupported.
  Sessions/items can span stations; do not sum their counts. Neither monitoring
  read proves Redis visibility, safe reassignment, or a WorkUnit-to-Session link.
- A training cohort uses current stored enrollment rows. Its latest completed
  step is not page abandonment or a confirmed stall. Current qualifying result
  rows are not lifetime payout history. Page rates are not global rates.
- Missing, partial, unavailable, or unlinked evidence is not zero. Narrow or
  withhold the conclusion instead.

## Inspect recorded earnings and billing

Use `get_billing_coworker_earnings` for recorded coworker earnings and
`list_billing_organizations` for stored subscription status. These require an
explicit staff `billing.read` grant. Read the billing sequence in the tool map
before calculating a rollup: currency pages repeat global coverage, complete
payout periods are selected by their end date, and decimal amounts must retain
their currency and precision. These tools do not calculate pending earnings,
verify settlement, expose invoices or attribute costs to batches.

## Assign through an approved proposal

1. Read the exact batch and backlog unit. Use assignment candidates to select an
   eligible opaque coworker for that unit. An onboarding recommendation contains
   a coworker UID, not a complete executable plan.
2. Call `create_operation_proposal` with a fresh `requestId`, exact `workUnitUid`,
   `coworkerUid` and reason. Retain the returned proposal UID and version. The
   server freezes targets, evidence, expected result, impact limits and expiry.
   Reuse a request ID only for the identical request; changed intent needs a new
   proposal.
3. Call `evaluate_operation_proposal` with the proposal UID and `expectedVersion`
   1. Report every BLOCK reason. PASS means the deterministic rules passed; it
   does not mean a human approved the proposal.
4. Call `request_operation_approval`. Present the returned `approval.reviewPath`
   on the configured API origin to a different authorized human. Approval needs
   a Django session and the explicit approval permission. There is no MCP
   approval tool, approval boolean, or elicitation substitute. Do not automate
   the approval page.
5. After `get_operation_proposal` shows independent approval, call
   `execute_approved_operation` for the same UID and version. This queues a fixed
   server executor; queued is not executed. If a call is ambiguous, re-read the
   proposal and its events before deciding whether to retry. The backend periodically
   recovers lost queued delivery and bounds transient database retries. Retry only the
   same proposal UID/version while approval remains valid; do not create a substitute
   proposal merely because execution is still queued.
6. Read `get_operation_proposal` for the execution result, then call
   `verify_operation` and `list_operation_events`. Historical lifecycle state
   and current verification are separate: a historically verified proposal may
   now have changed observations. Verification GET does not rewrite the persisted
   execution receipt timestamp or append audit events; unexecuted proposals return
   a conflict. Report assigned-work visibility, current
   dispatch eligibility, assignment revision and scope independently. Neither
   visibility nor a receipt proves annotation activity or production output.
7. `reverse_operation` records a new immutable BLOCKED child. Authoritative work
   progress and a cancellation handshake are unavailable, so it does not undo
   the assignment. Inspect the returned frozen original snapshot and execution
   evidence. Report that limit; do not substitute a retired direct write.

## Execute other reviewed changes

The six remaining workforce actions cover group membership, batch allocation,
batch creation, batch priority, batch status and sequence status. They retain
legacy confirmation and receipts; they do not acquire the proposal lifecycle's
independent approval or outcome verification merely by appearing in this skill.
They are unavailable to proposal-only credentials.

1. Re-read the exact target. Capture every expected status, timestamp, workflow
   revision, line-context UID and staffing state required by the action.
2. Use the dedicated impact preview for group membership or batch allocation.
   Present its blast radius and blockers without embellishment.
3. Explain the exact effect and reason, and let the reviewed MCP confirmation
   flow obtain human approval for those arguments.
4. Execute once. On an ambiguous response or stale-state error, inspect the
   current target and immutable operation history before another attempt.
5. Preserve `operationEventUid` and inspect `get_workforce_operation_event`.
   Receipt completeness establishes recorded execution evidence. Verify the
   intended current state through its dedicated read before reporting the
   operational outcome, and name any outcome that cannot be measured.

A new or reversed action needs its own current-state evidence and approval.
Never broaden a previous approval.

## Respect staffing boundaries

Global group membership can change qualification and platform capabilities
across many production lines. Batch allocation changes scheduling for one exact
allocated batch only. Prefer batch allocation when the request is batch-local;
never represent it as qualification. Before releasing work, verify both global
eligibility and any required exact-batch allocation.

New MCP-created batches begin unavailable. Staff them, inspect their generated
backlog and sequence state, and release them only through a separately approved
status change. Assignment requires an available batch, an unassigned backlog
unit, and an eligible opaque candidate returned for that exact unit.

## Report an auditable outcome

Return a compact operator record containing:

- exact opaque scope IDs and observation/window times;
- facts observed, including page/global and storage coverage;
- unsupported inferences or unavailable evidence;
- proposed action and blast radius, if no write was approved;
- proposal UID/version or legacy receipt UID, historical execution evidence,
  and separately observed current verification, if changed;
- the next safe read or separately approved intervention.

Never expose or request names, contacts, KYC, bank details, customer payloads,
raw task contents, or operator identity when the privacy-bounded MCP contract
omits them. Report recorded earnings only through an authorized billing contract.
