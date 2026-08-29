# What changes at the next production deploy

Measured against live production on **2026-08-29** through the Claude connector,
before any of the Phase 2 work shipped. Production is still serving the
pre-fix image, so everything in §1 is what a customer sees today.

Use this as the post-deploy checklist. Each item names the probe, what it
returns now, and what it must return after — so a deploy that half-applies is
visible rather than assumed.

---

## 1. Baseline, captured live

**`list_projects`** → `You do not have permission to perform this action.`

**`get_workspace_overview`** → HTTP 200, and:

```jsonc
{
  "organizations": [ … 6 orgs … ],
  "recentDatasets": [ … 5 datasets … ],
  "recentProjects": [],          // ← the tenant has ~100
  "recentExports": [],
  "errors": ["projects: AvalaError (HTTP 403)"]
}
```

Three defects are visible in that one response, and they compound:

1. **The failure is silent.** `recentProjects: []` is a claim that the set is
   empty. An agent reads it and tells the user they have no projects.
2. **The cause is buried.** `errors` sits at the bottom, nested, with no
   top-level flag. Nothing makes a reader look at it before answering.
3. **A refusal and an empty are indistinguishable.** `recentProjects` was
   *denied*; `recentExports` genuinely *returned nothing*. Identical shape. No
   reader — human or model — can tell which is which. That is §6.7 demonstrated
   in a single live response, without needing a separate investigation.

Tool descriptions still carry no `detail` parameter, which confirms the served
image predates the payload work.

---

## 2. What the merged work changes

| Change | Effect on the response above |
|---|---|
| Egress scrubbing (#15576) | Every tool result passes one un-bypassable scrubber. Presigned S3 URLs, STS tokens, emails and E.164 numbers cannot leave, including from the 24 tools that previously did no redaction at all. |
| Degraded contract (#15578) | `errors` becomes top-level `degraded: true` plus a named `unavailable` entry with a reason, a remedy and the HTTP status. **The failed part is omitted, not emptied** — so `recentProjects: []` disappears rather than lying. |
| Project route (landed) | `list_projects` / `get_project` call `/users/me/projects/` instead of the staff-only `/projects/`. |
| Composite route (#15585) | `get_workspace_overview` and `get_project_quality_summary` do the same, so the field actually populates rather than merely reporting its own failure honestly. |
| Payload work | `detail` defaults to `concise`; cursor pagination exposes `has_more` / `next_cursor`; count fields carry unambiguous names. |

The route fix and the degraded contract are **both** required and neither is
sufficient. Without the route fix, the overview reports the 403 honestly and
still shows no projects. Without the degraded contract, the route fix silently
changes an empty array into a populated one with no way to tell that anything
was ever wrong.

---

## 3. Post-deploy probes

Run these in order. Each is a single tool call.

1. **`list_projects`** — must return projects, not a permission error. If it
   still 403s, the image is stale or the route fix was reverted again (it has
   been, twice; see §5).
2. **`get_workspace_overview`** — `recentProjects` must be populated. There must
   be **no** `recentProjects: []` beside an error. If any part is genuinely
   unavailable, expect `degraded: true` at the top level and an `unavailable`
   entry naming the part, a remedy and a status.
3. **A tool that returns media** — confirm no `AWSAccessKeyId`, `Signature`, or
   `x-amz-security-token` appears anywhere in the response.
4. **Any list tool** — confirm `detail` is accepted, that the default response
   is the concise field set, and that `has_more` is present.
5. **`get_dataset_health` vs `list_datasets`** — the two `itemCount` fields must
   no longer disagree; each count field should name its unit.

### The one that is easy to get wrong

Probe 3 cannot be satisfied by *reading* the response and not noticing a
credential. Search the raw text for `AWSAccessKeyId` and `x-amz-`. A signed URL
is long, looks like ordinary media plumbing, and is exactly the thing a reader
skims past — which is how it shipped in the first place.

---

## 4. What will still be wrong after this deploy

Stated so nobody reads a green checklist as "the read path is done".

- **Attribution is not gated.** A bare human name is not detectable by pattern,
  so the egress scrubber does not remove `annotator: "Jane Doe"`. Identity is
  supposed to be absent by default and behind an explicit `include_attribution`,
  never in a list shape (read contract §3.2). That tool-boundary work is not
  built.
- **Signed URLs are scrubbed, not replaced.** The read contract calls for opaque
  handles plus a scope-checking resolver tool. Scrubbing is the net under that
  design, not the design.
- **`get_project_quality_summary` may still be thin.** Its other legs
  (quality targets, consensus) were never the 403; if it still returns little,
  that is a separate cause and should be diagnosed rather than assumed fixed.
- **Empty-vs-invisible is only fixed where a call actually fails.** If an
  upstream returns HTTP 200 with an empty list, the server cannot know whether
  the caller was permitted to see more. `list_exports`, `list_agents`,
  `list_storage_configs`, `list_webhooks` and `list_slices` need per-tool
  checking against a credential known to have data.

---

## 5. Deploy mechanics, and the thing to check first

The hosted service runs a **digest-pinned** image (`infra/mcp_server.tf`), so
merging to `develop` changes nothing in production by itself. The sequence is
the one in `reports/runbooks/MCP_PRODUCTION_ACTIVATION.md`: release to `main`,
build and push the image, record the immutable digest, set
`mcp_server_image_digest`, and have a human apply.

**Before running any probe above, confirm the served image is actually the new
one.** A stale image reproduces §1 perfectly, and every probe then "fails" for a
reason that has nothing to do with the code. The cheapest tell is a tool
description: if `list_projects` still lacks a `detail` parameter, the old image
is serving and there is nothing to verify yet.

**And re-check the project route specifically.** It has been silently reverted
twice by branches that merged cleanly — git reported no conflict, both PRs were
green, and no test caught it, because a mocked `projects.list` passes whichever
route the code calls. There are now route assertions for both the tools and the
composites, but they only fire if the reverting branch runs the suite *after*
merging develop rather than before.
