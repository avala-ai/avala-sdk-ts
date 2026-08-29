# MCP eval baseline

**No baseline has been measured yet.** This file is a placeholder, and it is
deliberately not a table of zeros — a report full of zeros reads like a result.

`make eval` overwrites this file with the real numbers on the first run that
completes.

## Task set (verified against `origin/feat/mcp-eval-tasks` @ `6fab8df6db`)

| file | pairs | gradeable | ungradeable |
|---|---|---|---|
| `adversarial.xml` | 9 | 7 | 2 |
| `read-customer.xml` | 13 | 3 | 10 |
| `read-ops.xml` | 14 | 14 | 0 |
| **total** | **36** | **24** | **12** |

Gradeable = has `<answer>` or `<rubric>` and no `<answer-todo>`.
`<precondition>` never blocks a run. Pinned by `test/evalTasks.test.ts`.

> **Counting warning.** Each file opens with a header comment that DOCUMENTS the
> schema, so `grep -c '<precondition>'` reports **10** where the real answer is
> **4**, and `grep -c '<answer>'` reports 9 where the real answer is 0. Strip XML
> comments before counting anything. This has produced a wrong count three times.

## Two things must be in place before a run means anything

1. **An Anthropic credential.** `ANTHROPIC_API_KEY`, or an `ant auth login`
   profile that the zero-arg SDK client picks up. Without one the runner exits 2
   before any trial and writes nothing here.
2. **Recorded cassettes.** `eval/cassettes/` is empty, so every tool call in a
   replay run is a loud miss, every trial is classified `cassette_miss`, and the
   run is reported **INVALID** rather than as a 0% score. Record with
   `make eval-record` (needs `AVALA_API_KEY`; responses are scrubbed on write).

## How the 12 ungradeable tasks become gradeable

Ground truth is derived **from the cassettes, never from a live query**. Once a
cassette set is committed it is a frozen world, so an answer derived from it is
stable by construction; a live lookup drifts the moment production changes.

The order is: build harness → record cassettes → derive answers from cassette
content → commit the answers alongside. For each `<answer-todo>` task, follow the
todo's own recipe against the *recorded* responses in `eval/cassettes/`, then ask
the task author to replace `<answer-todo>` with `<answer>`. Nothing in the harness
assumes answers already exist — the exact-match path is implemented and unit
tested, and simply has no live cases yet.

**Some customer answers will stay ungradeable, and that is a signal, not a
failure.** Projects, capture campaigns and workspace stats sit behind a 403 wall,
so those cassettes record 403s rather than data. Do not synthesise an answer for
them. `gradeable_tasks` is reported as a first-class number precisely so that it
rising is a direct measure of what the projects-route fix unlocks.

## What IS verified today

By `bunx vitest run` (302 tests, no API key needed):

- the transport path end to end — real `dist/index.js` over real MCP stdio,
  47 tools listed, calls routed to the local cassette server;
- all three hard gates fire on deliberately guilty input, including a fabrication
  with no failing tool call, which a signal-only detector cannot see;
- the three outcomes stay distinct, and `honest_refusal` renders as a good
  outcome rather than a failure;
- a `cassette_miss` is excluded from every rate instead of scored as a failure,
  and a high-miss run is declared INVALID above the metrics;
- the non-existence probes catch an inverted task both when the lookup succeeds
  and when the identifier merely appears in a listing body;
- the scrubber removes every credential class the recorder can encounter, and its
  output is never re-detected;
- the report refuses to present an all-errored or high-miss run as a measurement.

Harness overhead is 0.164 ms per tool call (measured over 1200 calls), so suite
wall clock is entirely model latency.
