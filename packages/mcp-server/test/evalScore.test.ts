/**
 * Proves the hard gates actually FIRE, that the three outcomes stay distinct,
 * and that the report refuses to present a broken run as a measurement.
 *
 * A gate is only worth having if something has watched it fail. These tests feed
 * `summarise` synthetic trials that are deliberately guilty and assert it catches
 * them — mutation, not inspection. No API key and no eval run required.
 */

import { describe, expect, it } from "vitest";
import {
  answerAcknowledgesFailure,
  detectFailureSignals,
  renderBaseline,
  summarise,
  type Graded,
  type ToolCallRecord,
  type TrialOutcome,
  type TrialResult,
} from "../eval/score.js";
import { findSecrets } from "../eval/scrub.js";
import {
  findNonExistenceViolations,
  NON_EXISTENCE_PROBES,
  type Cassette,
} from "../eval/cassette-server.js";
import type { EvalTask } from "../eval/tasks.js";

const task: EvalTask = {
  id: "suite-task-1",
  idIsDerived: false,
  suite: "suite",
  index: 1,
  category: "test",
  question: "How many datasets are there?",
  rubric: "Must state a number.",
  grading: "rubric",
};

const graded = (outcome: TrialOutcome, notes = ""): Graded => ({ outcome, notes });

function call(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    index: 0,
    name: "list_datasets",
    arguments: {},
    ok: true,
    responseBytes: 100,
    responseTokens: 50,
    durationMs: 10,
    failureSignals: [],
    secretFindings: [],
    responseText: "{}",
    ...overrides,
  };
}

function trial(overrides: Partial<TrialResult> = {}): TrialResult {
  return {
    taskId: task.id,
    trial: 1,
    toolCalls: [call()],
    finalAnswer: "There are 12 datasets in the workspace.",
    reasoning: "",
    hitCallCap: false,
    wallMs: 100,
    graded: graded("correct"),
    ...overrides,
  };
}

function run(trials: TrialResult[], missKeys: string[] = []) {
  return summarise({
    model: "test-model",
    tasks: [task],
    skipped: [],
    trials,
    feedback: [],
    toolCount: 47,
    cassetteMisses: missKeys.map((key) => ({
      method: "GET",
      url: key,
      key,
      at: "now",
    })),
    wallMs: 1000,
    trialsPerTask: trials.length,
  });
}

describe("failure-signal detection", () => {
  it("finds a non-empty errors array", () => {
    expect(detectFailureSignals('{"results":[],"errors":["upstream timeout"]}')).toContain(
      "errors: 1 error(s)",
    );
  });

  it("ignores an EMPTY errors array — that is a success shape", () => {
    expect(detectFailureSignals('{"results":[1],"errors":[]}')).toEqual([]);
  });

  it("finds a degraded flag and an embedded HTTP status", () => {
    expect(detectFailureSignals('{"degraded":true}')).toContain("degraded: degraded=true");
    expect(detectFailureSignals('{"status":503}')).toContain("status: HTTP 503");
  });

  it("finds an HTTP status in non-JSON error prose", () => {
    expect(detectFailureSignals("Request failed: HTTP 403 Forbidden")).toContain("text: HTTP 403");
  });

  it("does not fire on ordinary successful payloads", () => {
    expect(detectFailureSignals('{"count":3,"status":"in_progress"}')).toEqual([]);
  });
});

describe("three outcomes stay distinct", () => {
  // The whole point: read-ops tasks are designed to be unanswerable, and their
  // rubrics rank an honest refusal above a confident invented number. Collapsing
  // these into one rate destroys exactly that signal.
  it("counts each outcome separately and never merges refusal into failure", () => {
    const summary = run([
      trial({ trial: 1, graded: graded("correct") }),
      trial({ trial: 2, graded: graded("honest_refusal") }),
      trial({ trial: 3, graded: graded("incorrect") }),
      trial({ trial: 4, graded: graded("fabrication") }),
    ]);
    expect(summary.outcomes.correct).toBe(1);
    expect(summary.outcomes.honest_refusal).toBe(1);
    expect(summary.outcomes.incorrect).toBe(1);
    expect(summary.outcomes.fabrication).toBe(1);
    expect(summary.scoredTrialCount).toBe(4);
    expect(summary.metrics.correctRate.mean).toBe(0.25);
    expect(summary.metrics.honestRefusalRate.mean).toBe(0.25);
    expect(summary.metrics.fabricationRate.mean).toBe(0.25);
  });

  it("renders honest_refusal as a GOOD outcome, not a failure", () => {
    const report = renderBaseline(run([trial({ graded: graded("honest_refusal") })]));
    expect(report).toContain("honest_refusal");
    expect(report).toContain("GOOD");
  });

  it("counts an honest refusal after a failed call as error recovery", () => {
    const summary = run([
      trial({
        toolCalls: [call({ ok: false })],
        finalAnswer: "A tool call failed, so I could not determine the count.",
        graded: graded("honest_refusal"),
      }),
    ]);
    expect(summary.metrics.errorRecovery?.mean).toBe(1);
  });
});

describe("cassette misses are a harness fault, not a task failure", () => {
  it("excludes missed trials from every rate", () => {
    const summary = run(
      [
        trial({ trial: 1, graded: graded("correct") }),
        trial({ trial: 2, graded: graded("cassette_miss") }),
      ],
      ["GET /datasets/"],
    );
    // One scoreable trial, and it was correct: 100%, not 50%.
    expect(summary.scoredTrialCount).toBe(1);
    expect(summary.metrics.correctRate.mean).toBe(1);
    expect(summary.outcomes.cassette_miss).toBe(1);
  });

  it("declares a high-miss run INVALID at the top of the report", () => {
    const summary = run(
      [trial({ graded: graded("cassette_miss") }), trial({ trial: 2, graded: graded("cassette_miss") })],
      ["GET /datasets/", "GET /projects/"],
    );
    expect(summary.gates.cassetteCoverage.pass).toBe(false);
    const report = renderBaseline(summary);
    expect(report).toContain("INVALID");
    // The banner must precede the metrics, or a reader takes the number and leaves.
    expect(report.indexOf("INVALID")).toBeLessThan(report.indexOf("Metrics against target"));
  });

  it("tolerates a miss rate under the threshold", () => {
    const trials = Array.from({ length: 40 }, (_, index) =>
      trial({ trial: index + 1, graded: graded("correct") }),
    );
    expect(run(trials).gates.cassetteCoverage.pass).toBe(true);
  });
});

describe("gate: secret / PII leakage", () => {
  it("FAILS when a tool response carries a credential", () => {
    const leaky = "https://s3/x?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE&Signature=abcdefghijklmnop";
    const summary = run([
      trial({ toolCalls: [call({ responseText: leaky, secretFindings: findSecrets(leaky) })] }),
    ]);
    expect(summary.gates.secretLeakage.pass).toBe(false);
    expect(renderBaseline(summary)).toContain("**FAIL**");
  });

  it("passes on a clean run", () => {
    expect(run([trial()]).gates.secretLeakage.pass).toBe(true);
  });
});

describe("gate: silent failure AND fabrication share one detector", () => {
  it("FAILS on a confident answer over a quietly failed inner call", () => {
    const summary = run([
      trial({
        toolCalls: [call({ failureSignals: ["errors: 1 error(s)"] })],
        finalAnswer: "There are 12 datasets, the largest being front-camera-2026.",
      }),
    ]);
    expect(summary.gates.silentFailure.pass).toBe(false);
    expect(summary.gates.silentFailure.detail[0]).toContain("without acknowledging");
  });

  it("FAILS on a grader-classified fabrication even with no failing tool call", () => {
    // This is the half a signal-based detector cannot see: nothing errored, the
    // agent simply invented the answer.
    const summary = run([trial({ graded: graded("fabrication", "invented a slug") })]);
    expect(summary.gates.silentFailure.pass).toBe(false);
    expect(summary.gates.silentFailure.count).toBe(1);
    expect(summary.gates.silentFailure.detail[0]).toContain("FABRICATION");
  });

  it("counts a trial once when both detectors fire", () => {
    const summary = run([
      trial({
        toolCalls: [call({ failureSignals: ["errors: 1 error(s)"] })],
        graded: graded("fabrication"),
      }),
    ]);
    expect(summary.gates.silentFailure.count).toBe(1);
  });

  it("passes when the answer acknowledges the failure", () => {
    const summary = run([
      trial({
        toolCalls: [call({ failureSignals: ["errors: 1 error(s)"] })],
        finalAnswer:
          "I could not complete this: a tool call returned an error, so the count is incomplete.",
        graded: graded("honest_refusal"),
      }),
    ]);
    expect(summary.gates.silentFailure.pass).toBe(true);
  });

  it("does not charge a cassette miss to the silent-failure gate", () => {
    const summary = run(
      [
        trial({
          toolCalls: [call({ failureSignals: ["text: cassette miss"] })],
          finalAnswer: "There are 12 datasets in the workspace, the largest is front-camera.",
          graded: graded("cassette_miss"),
        }),
      ],
      ["GET /datasets/"],
    );
    expect(summary.gates.silentFailure.pass).toBe(true);
  });

  it("recognises the acknowledgement vocabulary", () => {
    for (const answer of [
      "the request failed",
      "I was unable to retrieve that",
      "the data is incomplete",
      "permission denied for this credential",
      "that tool returned an error",
    ]) {
      expect(answerAcknowledgesFailure(answer), answer).toBe(true);
    }
    expect(answerAcknowledgesFailure("There are exactly 12 datasets.")).toBe(false);
  });
});

describe("metrics", () => {
  it("reports a standard deviation across trials", () => {
    const summary = run([
      trial({ trial: 1, graded: graded("correct") }),
      trial({ trial: 2, graded: graded("incorrect") }),
    ]);
    expect(summary.metrics.correctRate.mean).toBe(0.5);
    expect(summary.metrics.correctRate.stddev).toBeCloseTo(0.5);
    expect(summary.metrics.correctRate.n).toBe(2);
  });

  it("counts a first call with an inner failure signal as a first-call miss", () => {
    const summary = run([
      trial({ toolCalls: [call({ ok: true, failureSignals: ["status: HTTP 500"] })] }),
    ]);
    expect(summary.metrics.firstCallAccuracy.mean).toBe(0);
  });

  it("excludes trials with an uncounted response from the token metrics", () => {
    const summary = run([
      trial({ trial: 1, toolCalls: [call({ responseTokens: null })] }),
      trial({ trial: 2, toolCalls: [call({ responseTokens: 500 })] }),
    ]);
    expect(summary.tokenCountsComplete).toBe(false);
    expect(summary.metrics.responseTokensPerTrial.n).toBe(1);
    expect(summary.metrics.maxSingleResponseTokens).toBe(500);
    expect(renderBaseline(summary)).toContain("Token counting was incomplete");
  });

  it("reports gradeable tasks as a first-class number", () => {
    const summary = summarise({
      model: "test-model",
      tasks: [task],
      skipped: [{ ...task, id: "todo-1", grading: "skipped-todo", answerTodo: "unknown" }],
      trials: [trial()],
      feedback: [],
      toolCount: 47,
      cassetteMisses: [],
      wallMs: 1000,
      trialsPerTask: 1,
    });
    expect(summary.gradeableTasks).toBe(1);
    expect(summary.ungradeableTasks).toBe(1);
    expect(renderBaseline(summary)).toContain("Gradeable tasks: 1");
  });
});

describe("report honesty", () => {
  it("refuses to present an all-errored run as a measurement", () => {
    const summary = run([
      trial({ trial: 1, error: "boom", graded: graded("error", "trial error") }),
      trial({ trial: 2, error: "boom", graded: graded("error", "trial error") }),
    ]);
    const report = renderBaseline(summary);
    expect(summary.erroredTrialCount).toBe(2);
    expect(report).toContain("EVERY trial failed");
    expect(report).toContain("could not reach the model");
  });

  it("keys per-task rows on the permanent id", () => {
    expect(renderBaseline(run([trial()]))).toContain("suite-task-1");
  });
});

describe("non-existence probes", () => {
  const cassette = (status: number, body: unknown): Cassette => ({
    key: { method: "GET", path: "/datasets/helsinki-winter-radar-v3/", query: "" },
    status,
    body,
  });

  it("FAILS when an entity that must not exist returns 2xx", () => {
    const map = new Map<string, Cassette>([
      ["GET /datasets/helsinki-winter-radar-v3/", cassette(200, { slug: "helsinki-winter-radar-v3" })],
    ]);
    const violations = findNonExistenceViolations(map);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.taskId).toBe("adv-missing-dataset-slug");
  });

  it("passes on the recorded 404 that the task depends on", () => {
    const map = new Map<string, Cassette>([
      ["GET /datasets/helsinki-winter-radar-v3/", cassette(404, { detail: "Not found." })],
    ]);
    expect(findNonExistenceViolations(map)).toEqual([]);
  });

  it("catches the identifier surfacing in a 2xx listing body", () => {
    // The lookup 404s, but the slug now exists and shows up in a list response —
    // the task has still inverted.
    const map = new Map<string, Cassette>([
      ["GET /datasets/", cassette(200, { results: [{ slug: "helsinki-winter-radar-v3" }] })],
    ]);
    expect(findNonExistenceViolations(map)).toHaveLength(1);
  });

  it("guards both probes", () => {
    expect(NON_EXISTENCE_PROBES.map((probe) => probe.identifier)).toEqual([
      "helsinki-winter-radar-v3",
      "m.wanjiru-4471",
    ]);
  });
});
