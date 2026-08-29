# MCP eval changelog

One entry per iteration on the tool surface. The point of this file is to make
it impossible to claim an improvement that the measurement does not support.

## Format

Every entry has four parts, in this order:

```markdown
## YYYY-MM-DD — <one-line description>

**Hypothesis:** what you believed was wrong with the tool surface, and why you
believed it. Name the evidence — a transcript path, an agent-feedback quote, a
metric row. "It felt verbose" is not a hypothesis.

**Change:** exactly what changed in the server. Files and tool names, not prose.

**Before / after:** every metric you are claiming moved, with standard
deviations, at the same trial count against the same cassettes.

| Metric | Before | After |
|---|---|---|
| Task success | 72.0% ± 8.1% | 88.0% ± 6.4% |
| Median tool calls / task | 6.20 | 4.00 |
| p95 response tokens / task | 31,402 | 18,880 |

**Kept or reverted:** and why.
```

## Rules

1. **A move smaller than the spread is not a result.** If the before and after
   error bars overlap, say so and either raise the trial count or record the
   change as "no measured effect". Do not report the mean alone.

2. **Change one thing per entry.** Two edits in one entry cannot be attributed,
   and the next person cannot revert half of it.

3. **Re-run the baseline, do not reuse an old one.** Cassettes, task files, and
   the model all drift. A comparison is only valid when both sides ran against
   the same fixtures at the same trial count — say which cassette revision
   (`git rev-parse --short HEAD` of `eval/cassettes/`) each side used.

4. **Reverted changes stay in this file.** A change that did not work is the
   most useful entry here, because it stops somebody trying it again.

5. **The two hard gates are not tunable.** Secret/PII leakage and silent
   failure are pass/fail at zero. An entry may never record "raised the
   threshold"; it records the fix.

<!--
No entries yet. The first entry belongs to whoever makes the first change to the
tool surface on the strength of a baseline run — not to the run that produced the
baseline, which is recorded in `baseline.md`.
-->
