# Workforce MCP tool map

Read the connected tool descriptions before calling anything. This reference
maps intent to the checked-in workforce catalog; live discovery still decides
whether the deployed server supports a tool and whether the current identity is
eligible to invoke it.

## Complete workforce surface

| Tool | Use | Scope |
|---|---|---|
| `get_workforce_operations_overview` | Start with aggregate coworker readiness, sessions, queue state, and attention signals. | `workforce.read` |
| `get_workforce_session_monitoring` | Page definition-level session state and ended_at window counts across all projects; keep unknown end times separate from measured endings. | `workforce.read` |
| `get_workforce_station_monitoring` | Inspect retained station links; coverage is incomplete and cross-station counts are not additive or historical throughput. | `workforce.read` |
| `list_blocked_onboarding_coworkers` | Scan bounded onboarding blockers, preserve unknown durations and identity conflicts, then inspect the exact journey before recommending an approved action. | `workforce.read` |
| `list_coworker_training_candidates` | Scan for completed Learning with no current accepted or paid-without-review production result, then inspect the selected journey. | `workforce.read` |
| `list_workforce_training_cohort_evidence` | Join one exact journey and stored-enrollment window to latest progress evidence and current qualifying output. | `workforce.read` |
| `get_workforce_coworker_reliability` | Compare sampled queue observations with recorded output; never infer intent or idleness. | `workforce.write` |
| `get_coworker_journey` | Inspect one exact privacy-bounded account, Learning, access, and production journey. | `workforce.read` |
| `list_workforce_batches` | Enumerate production lines with exact context, status, priority, staffing mode, and unit counts. | `workforce.read` |
| `get_workforce_dispatch_health` | Inspect current released, claimable, and blocked work with a sampled-observation receipt. | `workforce.read` |
| `get_workforce_dispatch_observations` | Read sparse historical dispatch-health samples over a bounded storage-aware window. | `workforce.read` |
| `get_workforce_dispatch_outcomes` | Read recorded release to queue-visibility to claim evidence over a bounded window. | `workforce.read` |
| `list_workforce_operation_events` | Search immutable mutation receipts over a bounded occurrence window. | `workforce.write` |
| `get_workforce_operation_event` | Inspect recorded evidence in one exact immutable mutation receipt; verify the current outcome separately. | `workforce.write` |
| `list_workforce_groups` | Discover global qualification groups and aggregate readiness without member identities. | `workforce.write` |
| `list_workforce_group_members` | Inspect one privacy-bounded group readiness roster. | `workforce.write` |
| `preview_workforce_group_membership_impact` | Preview global qualification/capability blast radius before membership change. | `workforce.write` |
| `get_workforce_batch_attention` | Drill into fixed queue-age and role/status signals for one exact batch. | `workforce.read` |
| `list_workforce_batch_units` | Inspect bounded opaque unit state before proposing assignment or diagnosing recovery. | `workforce.read` |
| `get_workforce_sequence_status` | Read exact workflow state, observation tokens, and authorized next transitions. | `workforce.read` |
| `list_workforce_assignment_candidates` | Get eligible opaque candidates for one exact unassigned backlog unit. | `workforce.write OR operations.proposal.read` |
| `list_workforce_batch_staffing_candidates` | Inspect privacy-bounded qualification, allocation, readiness, and raw outcome signals for one batch. | `workforce.write` |
| `list_workforce_batch_coworker_activity` | Monitor exact-batch pseudonymous assignment and raw activity signals without rankings. | `workforce.write` |
| `preview_workforce_batch_allocation_impact` | Preview one exact allocated-batch scheduling change. | `workforce.write` |
| `change_workforce_group_membership` | Apply one reviewed global qualification membership change from its exact preview. | `workforce.write` |
| `change_workforce_batch_allocation` | Apply one reviewed scheduling change to one exact allocated batch. | `workforce.write` |
| `create_workforce_batch` | Create an unavailable sequence-scoped batch with a bounded backlog plan. | `workforce.write` |
| `set_workforce_batch_priority` | Apply one reviewed priority change against freshly observed state. | `workforce.write` |
| `set_workforce_batch_status` | Apply one reviewed available, unavailable, or archived lifecycle change. | `workforce.write` |
| `set_workforce_sequence_status` | Apply one reviewed workflow-authorized sequence transition. | `workforce.write` |
| `create_operation_proposal` | Freeze one exact unit/coworker, reason, expected effect and impact; no assignment occurs. | `operations.proposal.create` |
| `evaluate_operation_proposal` | Run deterministic PASS/BLOCK rules for the frozen version; PASS is not approval. | `operations.proposal.create` |
| `get_operation_proposal` | Read historical lifecycle, frozen evidence and current verification separately. | `operations.proposal.read` |
| `request_operation_approval` | Obtain the Django review path for a different authorized human session. | `operations.approval.request` |
| `execute_approved_operation` | Queue the fixed executor for an independently approved UID/version. | `operations.execution.request` |
| `verify_operation` | Read current assigned-work visibility, dispatch eligibility, assignment revision and scope; production activity is unmeasured. | `operations.verification.read` |
| `reverse_operation` | Record a BLOCKED reversal child; no cancellation or domain reversal occurs. | `operations.proposal.create` |
| `list_operation_events` | Read bounded append-only evidence with increasing sequence cursors. | `operations.proposal.read` |

The staff SQL sandbox is a separate read-only diagnostics surface. It is not a
substitute for any mutation above, for a privacy-bounded person lookup, or for a
missing domain contract.

## Separate billing reads

| Tool | Use | Scope |
|---|---|---|
| `get_billing_coworker_earnings` | Read recorded payout-period totals by currency and explicit coverage; optionally filter one opaque coworker. | `billing.read` + staff privilege |
| `list_billing_organizations` | Read opaque organization IDs and stored subscription status; missing records remain unknown. | `billing.read` + staff privilege |

### Inspect financial records

1. Choose a past half-open `periodEndedFrom` / `periodEndedBefore` window of at
   most 31 days. `get_billing_coworker_earnings` selects records whose period end
   falls in that window and includes each full period amount, without proration.
2. Preserve the exact coworker filter and window across every `currencyCursor`.
   Coverage applies to all filtered records and repeats on each page; count it
   once. Invalid-reason counts overlap and cannot be summed as excluded records.
3. Keep decimal-string amounts in their original currencies. Do not use binary
   floating-point money arithmetic or combine currencies without a separately
   sourced conversion policy. Worked time is milliseconds, not hours.
4. Report recorded amounts and excluded/unknown coverage. Overlapping payout
   periods are not deduplicated. Stored records do not prove settled payments,
   complete historical earnings, pending liabilities, or per-batch costs.
5. For subscription questions, `list_billing_organizations` returns a stored
   snapshot. Follow its cursor with unchanged filters; `missing` and
   `invalid_status` are unknown, not inactive. This is not a live provider check
   and has no invoice or customer usage charge totals.

## Common operating sequences

### Monitor production progress

1. `get_workforce_operations_overview`
2. `list_workforce_batches` with the narrowest known line-context filters; scan
   all pages.
3. `get_workforce_batch_attention` for batches with review, error, or aging
   signals.
4. `list_workforce_batch_units` only when unit-level state is needed.

### Diagnose dispatch

1. `get_workforce_dispatch_health` for current state and its observation receipt.
2. `get_workforce_dispatch_outcomes` for bounded recorded release, queue, and
   claim evidence.
3. `get_workforce_dispatch_observations` only for storage-covered sampled
   historical blockers. Do not project current blockers backward.

### Inspect session and station progress

- Use `get_workforce_session_monitoring` with offset-aware `endedFrom` and
  `endedBefore` for an increasing past half-open window of at most 31 days.
  Narrow by `sessionDefinitionUid` when known. Its state/attention counts are
  current; its terminal counts use `ended_at`, never redrive's `updated_at`.
  Samples include at most 1000 newest-created rows per status, across all projects.
  False `statusCountsComplete` means that status's counts are lower bounds;
  `countsComplete` requires all five statuses complete. Terminal-window completeness
  requires both finished and abandoned flags. A truncated zero never proves no
  endings. Unknown end times cover sampled terminal sessions, not the window.
- Use `get_workforce_station_monitoring` with exact `stationUid`, `projectUid`
  or `sessionDefinitionUid` filters. `sessionCount` deduplicates sessions;
  `taskLinkCount` includes redundancy and review-result links; `itemCount`
  deduplicates non-null item IDs. At most 1000 retained links are sampled per
  station; false `countsComplete` means lower bounds. `unknownStatusTaskLinks`
  preserves sampled links outside known statuses. This sample completeness never
  establishes historical completeness: deleted recovery links are unavailable.
- Both tools page by UID with `limit` 1–10 (default 5). Preserve filters on `nextCursor`.
  Do not aggregate station counts into system totals: sessions and items may
  span stations. Neither read establishes infrastructure health, Redis queue
  visibility, completed annotation throughput, upload/acceptance, or billing.
- Work units have no direct Session foreign key. These aggregate reads cannot
  identify a safe session reassignment or satisfy reversal's missing progress
  and cancellation handshake. Use the existing exact work-unit proposal path
  only when the requested intervention and its evidence support it.

### Assess a training cohort

1. `list_workforce_training_cohort_evidence` from the first page with exact
   journey and half-open enrollment window.
2. Follow every cursor unchanged. Use members, not summed page rates, for a
   multi-page rollup.
3. Treat the last completed step as a progress point, not a confirmed stall.
4. Use `get_coworker_journey` for an exact member follow-up.

### Staff and release a new batch

1. `get_workforce_sequence_status`
2. `create_workforce_batch` after approval; keep the returned receipt.
3. `list_workforce_batch_staffing_candidates`
4. For allocated staffing: `preview_workforce_batch_allocation_impact`, then
   `change_workforce_batch_allocation` after approval.
5. Re-read the batch and `set_workforce_batch_status` to available only after a
   separate approval.
6. Inspect each receipt with `get_workforce_operation_event`, then re-read the
   batch and current state. Receipt completeness does not prove the production
   outcome. These legacy actions require a credential without proposal scopes.

### Assign through a proposal or diagnose recovery

1. `list_workforce_batch_units`, then `list_workforce_assignment_candidates` for
   one exact backlog unit. Preserve the selected unit and coworker UIDs.
2. `create_operation_proposal` with `requestId`, `workUnitUid`, `coworkerUid` and
   reason. Retain the proposal UID and version; reuse request IDs only for
   identical intent.
3. `evaluate_operation_proposal` with `proposalUid` and `expectedVersion: 1`.
   Stop on BLOCK; PASS is not human approval.
4. `request_operation_approval`; give the returned Django `reviewPath` on the API
   origin to a different authorized human. No MCP tool or elicitation can grant
   this approval.
5. `get_operation_proposal` to observe approval, then
   `execute_approved_operation` for that exact UID/version. Queued is pending.
6. After execution, `verify_operation` and `list_operation_events`. Follow
   `nextAfter` while `hasMore`. Current verification may be changed even when
   historical state is verified. Assignment visibility can remain true after
   dispatch eligibility changes; production activity remains unmeasured.
7. `reverse_operation` creates a new BLOCKED child because progress and
   cancellation evidence are unavailable. It does not undo the assignment.

These are five POST lifecycle commands and three GET observations; verification
uses GET. Proposal scopes suppress all legacy writes, including mixed grants
that also contain `workforce.write`. Use fresh proposals for changed targets or
intent, and never bypass the blocked reversal through another write surface.

### Change qualification versus scheduling

- Global qualification: `list_workforce_groups`,
  `list_workforce_group_members`,
  `preview_workforce_group_membership_impact`, then
  `change_workforce_group_membership` after approval.
- One-batch scheduling: `list_workforce_batch_staffing_candidates`,
  `preview_workforce_batch_allocation_impact`, then
  `change_workforce_batch_allocation` after approval.

Never use global membership to satisfy a batch-local request without showing
its cross-line and platform-capability blast radius.
