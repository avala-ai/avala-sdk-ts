# Avala MCP Read Contract

Status: proposed, 2026-08-28. Owner: MCP server. Review required from whoever
owns SOC 2 Type II before the ops read surface ships.

The Safety Contract governs **writes** — proposal, evaluation, approval,
execution, verification, reversal, audit. Nothing governs **reads**, and reads
are where the next ninety days' most likely incident lives, because a read needs
no approval, leaves no proposal, and is invisible in the audit trail the write
path builds. This document is the missing half.

It exists because a violation was already shipped and measured: see §2.

---

## 1. Why an MCP read is not an API read

A REST response goes to one caller. An MCP tool response goes into a model's
context window, and from there into the client's transcript, the client's logs,
the provider's request logs, any trace/eval store, and — for a hosted client —
a third party's retention window. One tool call fans out to sinks the API
boundary never had.

Two consequences the rest of this document follows from:

- **Every field is a decision.** A field is not returned because it was in the
  upstream response. It is returned because someone decided its disclosure to
  all of the above is acceptable. Upstream inclusion is not that decision.
- **"The caller was authorized" is not sufficient.** Authorization decides
  whether the *caller* may see it. It says nothing about whether the caller's
  model provider, log pipeline, and eval store may. Minimization is a separate
  control from authorization and neither substitutes for the other.

---

## 2. The violation this document is written against

`src/redact.ts` matches **key names** — `apiKey`, `awsSecretAccessKey`, `token`.
Against the shipped module, on 2026-08-28:

```
in : { logo: "https://…/logo.png?AWSAccessKeyId=AKIA…&Signature=…&x-amz-security-token=Fwo…",
       exportSnippet: { annotator: "Jane Doe", reviewerEmail: "…@avala.ai", username: "+2547…" } }
out: byte-for-byte identical
```

`AWSAccessKeyId` is in the deny-list — as a key name. Here it is a query
parameter inside a string, where key-name matching cannot reach it. Separately,
24 of 64 tools serialize upstream JSON with a bare `JSON.stringify` and reach no
redaction at all.

The lesson is structural, not a missing entry: **a deny-list keyed on field
names cannot see a credential carried in a value.** Adding `logo` to the list
fixes one field and leaves the class open.

---

## 3. Data classification

Four tiers. Every field the MCP can return has exactly one.

| Tier | Definition | Default in responses |
|---|---|---|
| **P0 Public** | Non-identifying resource facts: names, slugs, uids, types, counts, statuses, timestamps | Returned freely |
| **P1 Internal operational** | Tenant-scoped operational state: project/task state, quality metrics, campaign config, aggregate throughput | Returned to an authorized caller |
| **P2 Personal** | Any datum about an identifiable person: names, emails, phone numbers, per-person attendance, active time, productivity, annotator/reviewer attribution | **Never by default.** Explicit parameter + scope, never in a list shape |
| **P3 Restricted** | KYC, identity documents, payment/payout detail, government identifiers, credentials of any kind | **Never returned by any tool, under any parameter.** Not reachable through this surface |

### 3.1 On this platform a username is a phone number

`server/apps/account/api.py`: for coworkers the account `username` **is the
SMS-OTP phone number**. So the field that looks most like a safe opaque
identifier is P2 personal data — an E.164 number belonging to a member of the
Kenyan workforce — for the entire coworker population.

Any rule of the shape "return identifiers, never names" is therefore false here
and will leak on its first use. `username`, `handle`, and any field derived from
them are classified by what they *contain* on this platform, not by what their
name suggests elsewhere. Use `uid` when an opaque identifier is what you want;
it is the only field that is one.

### 3.2 Attribution is P2, and it is already in a list shape

`exportSnippet` carries annotator and reviewer identity. Attribution is P2: it
names which person did which piece of work, which is worker-monitoring data
about an identifiable individual. It is available only behind an explicit
`include_attribution: true`, only on single-record tools, and never on a list
tool — a list is where one call turns into a roster.

---

## 4. Minimization by default

- **List responses return P0 and aggregate P1 only.** Identifiers and counts. No
  names, no contact details, no per-person rows, no P2 under any parameter.
- **Detail is opt-in.** Every list and get tool takes `detail`, defaulting to
  `concise`. Concise is roughly uid, name, slug, type, status, owner, counts,
  updatedAt. Labels, nested collections, and media move to `detail: "full"` or
  to a dedicated tool.
- **Per-person detail must be justified by the task, not by convenience.**
  Attendance, active time and productivity are worker-monitoring data. Return
  aggregates and identifiers; per-person rows require an explicit parameter and
  scope, and the ops task must actually need them. "It was already in the
  response" is not a justification — see §1.

---

## 5. Credentials never cross the boundary

**No signed URL, token, key, or session artifact leaves the MCP.** Not redacted
in place, not truncated — not present.

- **Opaque handles.** A tool that would return a signed URL returns
  `{ "asset": { "handle": "ah_<opaque>", "contentType": …, "bytes": … } }`. The
  handle carries no credential and is meaningless without the resolver.
- **A separate resolver tool** exchanges a handle for a time-boxed URL, checks
  the caller's scope at resolve time, and is annotated so a client can require
  confirmation. Resolution is a deliberate, separately auditable act — not a
  side effect of listing something.
- **Scrubbing is value-level, not key-level.** The scanner inspects every string
  value for AWS credential query parameters, `AKIA`/`ASIA` key ids, long
  signature/token parameters, JWTs, and bearer tokens — the class §2 proves a
  key-name list cannot see. It is defence in depth *behind* the handle rule,
  never the primary control: a scrubber that has something to scrub means a tool
  tried to return a credential.
- **The gate is build-failing.** A test scans every committed cassette and every
  default-shape response and fails CI on a match. Fixtures are recorded from the
  real API, so without this the credentials end up in git rather than in a log.

---

## 6. Degraded responses — reads fail loud

The write path fails closed. The read path must fail **loud**, which is the same
principle: never present the absence of an answer as an answer.

A partial result MUST carry:

```jsonc
{
  "degraded": true,
  "unavailable": [{
    "part": "projects",
    "reason": "credential lacks project:read",
    "remedy": "Ask an org admin to grant project:read, or use the staff toolset.",
    "status": 403
  }],
  // ... the parts that DID succeed, complete and unqualified
}
```

- **`degraded` is top-level.** Nested inside an `errors` array it is not read,
  which is exactly how `get_workspace_overview` came to return
  `recentProjects: []` with the cause buried and an agent concluding the tenant
  had no projects.
- **An empty array and an unavailable array must never be the same shape.** If a
  part failed, that part is absent and named in `unavailable` — it is not `[]`.
  `[]` is a claim that the set is empty, and a tool must only make that claim
  when it is true.
- **Error text names the next action.** `AvalaError (HTTP 403)` names none.
  Prose is for the human; the machine-readable `reason` code is what a client
  keys on. Both, always — a client that must parse prose has no contract.
- **A read that cannot be performed is not a read that returned nothing.** An
  agent must be able to tell "no such records exist" from "I could not look".
  `list_exports`, `list_agents`, `list_storage_configs`, `list_webhooks`,
  `list_slices` and `get_fleet_health` currently return empty for one of those
  two reasons and do not say which.

---

## 7. Payload budget

| Bound | Limit |
|---|---|
| Single tool response | < 8,000 tokens |
| Total tool-response tokens per task | < 25,000 (p95) |
| Default list page | 20–50 items |

Pagination is cursor-based on every list tool: `has_more`, `next_cursor`, and
`total_count` where it is cheap. Server-side filtering is mandatory — filtering
client-side works at 500 daily actives and dies at 15,000.

A budget without a test is a wish: a test asserts no default-detail list
response exceeds the per-response ceiling.

---

## 8. Cross-border and jurisdiction

Coworker data originates in Kenya and reaches US-hosted inference. Kenya's Data
Protection Act 2019 is GDPR-shaped: a Data Commissioner, lawful-basis
requirements, data-subject rights, and conditions on transfer outside Kenya.

Positions to be confirmed by the SOC 2 owner and Legal — recorded here so the
review has something concrete to disagree with, **not** presented as settled:

- **Lawful basis.** Performance of the work contract for operational data;
  legitimate interest for aggregate quality and throughput. Neither covers
  routing P2 to a third-party model provider merely because it was convenient to
  include — which is the practical force of §4.
- **Transfer.** Every P2 field crossing to US inference needs a named transfer
  basis. The cheapest compliance posture is the one §4 already requires: do not
  transfer it. Aggregates and `uid`s carry no transfer question.
- **Retention.** Transcripts and logs containing P2 inherit the shortest
  retention of any sink they reach, which for a hosted client is *not ours to
  set*. Treat any P2 field entering a transcript as retained beyond our control
  — this is the argument for §4 being a hard default rather than a nudge.
- **Data subject access request.** A DSAR must be answerable for MCP-mediated
  access: which tool calls touched this person's data, when, by which
  credential. That requires the audit trail in §10 to record it, and that is a
  build item, not a documentation item.

**Open question for review, stated plainly:** we do not today have a mechanism
to expire P2 out of a third-party client's transcript store. Until we do, §4 is
the only real control, and any proposal to relax it is a proposal to place
Kenyan workers' personal data somewhere we cannot retract it from.

---

## 9. Trust boundary: customer vs internal

The same server backs customer tenants (Lucid, Serve, Torc, Physical
Intelligence) and internal ops tooling. A customer credential must never be one
permission bug away from `send_coworker_message`.

**Decision: hard-partitioned scopes in one server, enforced by test — not two
servers.** Two servers is the stronger boundary and is rejected for a specific
reason: it duplicates the tool surface, and a duplicated surface drifts. The
2026-08 record shows the drift is real — 24 hand-written tools already diverged
from the catalog's sanitization, annotations and output schemas *inside a single
codebase*. Two codebases would make that the steady state, and a partition that
holds in one and not the other is worse than one partition everybody tests.

What that decision obliges:

- Every tool declares `avala.ai/required-scope` and a toolset. 23 tools declare
  no scope today; that is the gap to close first, because an undeclared scope
  cannot be partitioned.
- A test asserts **no customer-scoped token can enumerate or call an ops tool**,
  and that ops tools are absent from a customer catalog listing.
- Tool listing is UX, never a control — the REST route re-authorizes every call.
  A hidden tool called by name must still be refused by the route.
- **A staff tool may map only to a route composing
  `IsStaffAndNotApiKeyOrStaffApiKey`.** Plain `IsStaff` is satisfied by a staff
  member's ordinary data-plane key (pentest `apikey/s3-2`), and the MCP layer
  carries no authorization of its own — it forwards. This is already the rule in
  `.claude/rules/security.md`; it is restated because the read surface is where
  it will be violated by accident.

---

## 10. Audit

An MCP read is audited as: tool name, caller identity, credential kind, tenant,
timestamp, and the **shape** of what was returned — record counts and field
tiers, never the payload. §8's DSAR requirement depends on this record existing.

Never log a full tool response containing P2. Log shapes and counts.

---

## 11. What this document does not do

It does not make the read path safe. It states what safe means so the gap is
measurable. As of 2026-08-28 the surface violates §5 (24 tools with no redaction,
and a value-blind scrubber on the rest), §6 (composite tools return 200 with the
cause buried), and §7 (no `detail` parameter, no pagination contract on most list
tools). Those are tracked as Phase 2 of the standing brief, and each fix ships
with an eval task that would have caught the old behaviour.

A contract whose violations are known and counted is doing its job. One that is
written and never measured against is decoration — which is why every clause
above that can be tested names its test.
