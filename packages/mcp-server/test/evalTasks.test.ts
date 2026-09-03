/**
 * Pins the task-file contract and the counts the whole eval depends on.
 *
 * These assertions exist because the count was got wrong three times in one
 * afternoon — by two agents and by a `grep -c` — and a miscount baked into the
 * first baseline propagates silently through every later comparison.
 */

import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTasks, parseTaskFile } from "../eval/tasks.js";
import { NON_EXISTENCE_PROBES } from "../eval/cassette-server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = join(HERE, "..", "eval", "tasks");

describe("task file contract", () => {
  it("parses the committed set to exactly 27 gradeable / 12 ungradeable", async () => {
    const { tasks, skipped } = await loadTasks(TASKS_DIR);
    expect(tasks.length + skipped.length).toBe(39);
    expect(tasks.length).toBe(27);
    expect(skipped.length).toBe(12);
  });

  it("matches the per-suite split", async () => {
    const { tasks, skipped } = await loadTasks(TASKS_DIR);
    const bySuite = (suite: string) => ({
      runnable: tasks.filter((task) => task.suite === suite).length,
      skipped: skipped.filter((task) => task.suite === suite).length,
    });
    expect(bySuite("adversarial")).toEqual({ runnable: 7, skipped: 2 });
    expect(bySuite("read-customer")).toEqual({ runnable: 4, skipped: 10 });
    expect(bySuite("read-ops")).toEqual({ runnable: 16, skipped: 0 });
  });

  it("gives every task a declared, unique id", async () => {
    const { tasks, skipped } = await loadTasks(TASKS_DIR);
    const all = [...tasks, ...skipped];
    expect(all.every((task) => !task.idIsDerived)).toBe(true);
    expect(new Set(all.map((task) => task.id)).size).toBe(all.length);
  });

  it("pins every element count against known constants", async () => {
    // Verified independently against a clean `git archive` of
    // origin/feat/mcp-eval-tasks @ 6fab8df6db. These are the numbers a stale
    // merge, a dropped element or a bad parser change would move.
    const { tasks, skipped } = await loadTasks(TASKS_DIR);
    const all = [...tasks, ...skipped];
    const count = (predicate: (task: (typeof all)[number]) => unknown) =>
      all.filter(predicate).length;

    expect(all).toHaveLength(39);
    expect(tasks).toHaveLength(27);
    expect(skipped).toHaveLength(12);
    expect(count((task) => task.answer)).toBe(0);
    expect(count((task) => task.rubric)).toBe(27);
    expect(count((task) => task.answerTodo)).toBe(12);
    expect(count((task) => task.precondition)).toBe(4);
    expect(new Set(all.map((task) => task.id)).size).toBe(39);
  });

  it("keeps operation-history reconciliation evidence-safe", async () => {
    const { tasks } = await loadTasks(TASKS_DIR);
    const history = tasks.find(
      (task) => task.id === "workforce-operation-history-reconciliation",
    );

    expect(history).toMatchObject({
      suite: "read-ops",
      category: "mutation-verification",
      grading: "rubric",
    });
    expect(history?.rubric).toContain("list_workforce_operation_events");
    expect(history?.rubric).toContain("preserving all other filters");
    expect(history?.rubric).toContain("not that no change occurred");
  });

  it("keeps the sf-lidar readiness regression gradeable", async () => {
    const { tasks } = await loadTasks(TASKS_DIR);
    const regression = tasks.find(
      (task) => task.id === "recon-sf-lidar-readiness",
    );

    expect(regression).toMatchObject({
      suite: "read-customer",
      category: "reconstruction-readiness",
      grading: "rubric",
    });
    expect(regression?.rubric).toContain("identify both LiDAR calibration");
    expect(regression?.rubric).toContain(
      "ingest, sequence presence, and frame presence passed",
    );
  });

  it("counts exactly 4 real preconditions, whatever the headers say", async () => {
    // The invariant is the parser's count, NOT that a bare grep disagrees with
    // it. An assertion like `expect(rawGrepHits).toBeGreaterThan(4)` would pin
    // the DEFECT in place: it passes only while the header comments contain
    // literal `<precondition>` text, so improving those headers — a strict
    // improvement — would turn the build red for no reason. Never write a test
    // whose failure condition is "someone fixed the thing".
    const { tasks, skipped } = await loadTasks(TASKS_DIR);
    const parsed = [...tasks, ...skipped].filter((task) => task.precondition).length;
    expect(parsed).toBe(4);
  });

  it("keeps a bare grep and the parser in AGREEMENT", async () => {
    // The recurrence guard. It is the INVERSE of "assert grep over-counts":
    // that version pinned the defect and would have gone red when someone fixed
    // the headers. This one is green once element names stop appearing in
    // bracketed form in prose, and goes red if anyone re-arms the trap by
    // writing `<precondition>` into a comment again.
    //
    // Why it matters beyond tidiness: the miscount is not only inflation.
    // read-ops.xml greps as 2 preconditions and 2 answer-todos while containing
    // ZERO of either, so a per-file grep gate reports read-ops as partly
    // ungradeable when all 14 of its tasks are runnable — a healthy file made to
    // look broken. Every count in this thread, including the reviewer's own gate
    // commands, was wrong for this reason.
    const files = (await readdir(TASKS_DIR)).filter((name) => name.endsWith(".xml")).sort();
    const { tasks, skipped } = await loadTasks(TASKS_DIR);
    const all = [...tasks, ...skipped];

    const elements = [
      ["precondition", (task: (typeof all)[number]) => task.precondition],
      ["answer-todo", (task: (typeof all)[number]) => task.answerTodo],
      ["rubric", (task: (typeof all)[number]) => task.rubric],
      ["answer", (task: (typeof all)[number]) => task.answer],
    ] as const;

    const disagreements: string[] = [];
    for (const [name, pick] of elements) {
      let raw = 0;
      for (const file of files) {
        raw += (await readFile(join(TASKS_DIR, file), "utf8")).split(`<${name}>`).length - 1;
      }
      const parsed = all.filter(pick).length;
      if (raw !== parsed) {
        disagreements.push(`<${name}>: grep=${raw} parser=${parsed}`);
      }
    }

    expect(
      disagreements,
      "A bare grep disagrees with the parser, which means element names appear in " +
        "bracketed form somewhere outside a <qa_pair> — almost always the schema " +
        "contract in a file header. Write the contract WITHOUT angle brackets " +
        '("answer-todo means ..." rather than "<answer-todo> means ...") so a ' +
        "grep-based check cannot silently return a wrong count.\n  " +
        disagreements.join("\n  "),
    ).toEqual([]);
  });

  it("ignores elements that appear only inside an XML comment", () => {
    // This is the capability that makes the count above trustworthy, pinned on
    // synthetic input so it holds no matter how the real headers are written.
    const xml = `<evaluation>
      <!-- Contract: <answer-todo> means ungradeable; <precondition> is build-time. -->
      <qa_pair id="p1">
        <category>c</category><question>q</question><rubric>r</rubric>
      </qa_pair>
    </evaluation>`;
    const [task] = parseTaskFile(xml, "suite");
    expect(parseTaskFile(xml, "suite")).toHaveLength(1);
    expect(task!.answerTodo).toBeUndefined();
    expect(task!.precondition).toBeUndefined();
    expect(task!.grading).toBe("rubric");
  });

  it("treats <precondition> as never blocking a run", () => {
    const xml = `<evaluation><qa_pair id="p1">
      <category>c</category><question>q</question><why>w</why>
      <rubric>r</rubric><precondition>verify something at build time</precondition>
    </qa_pair></evaluation>`;
    const [task] = parseTaskFile(xml, "suite");
    expect(task!.grading).toBe("rubric");
    expect(task!.precondition).toContain("verify something");
  });

  it("treats <answer-todo> as blocking even beside a rubric", () => {
    const xml = `<evaluation><qa_pair id="p1">
      <category>c</category><question>q</question><why>w</why>
      <rubric>r</rubric><answer-todo>unknown</answer-todo>
    </qa_pair></evaluation>`;
    expect(parseTaskFile(xml, "suite")[0]!.grading).toBe("skipped-todo");
  });

  it("does not index positionally — element order is not guaranteed", () => {
    const xml = `<evaluation><qa_pair id="p1">
      <why>w</why><rubric>r</rubric><question>q</question><category>c</category>
    </qa_pair></evaluation>`;
    const [task] = parseTaskFile(xml, "suite");
    expect(task!.question).toBe("q");
    expect(task!.category).toBe("c");
    expect(task!.grading).toBe("rubric");
  });

  it("ignores unknown elements rather than throwing", () => {
    const xml = `<evaluation><qa_pair id="p1">
      <category>c</category><question>q</question><rubric>r</rubric>
      <some-future-element>whatever</some-future-element>
    </qa_pair></evaluation>`;
    expect(parseTaskFile(xml, "suite")[0]!.grading).toBe("rubric");
  });

  it("falls back to file#index when a pair has no id, and flags it", () => {
    const xml = `<evaluation><qa_pair>
      <category>c</category><question>q</question><rubric>r</rubric>
    </qa_pair></evaluation>`;
    const [task] = parseTaskFile(xml, "suite");
    expect(task!.id).toBe("suite#1");
    expect(task!.idIsDerived).toBe(true);
  });

  it("rejects duplicate ids — they would merge two tasks into one report row", async () => {
    // Guarded at load time because ids are the CHANGELOG join key.
    const xml = `<evaluation>
      <qa_pair id="dup"><category>c</category><question>a</question><rubric>r</rubric></qa_pair>
      <qa_pair id="dup"><category>c</category><question>b</question><rubric>r</rubric></qa_pair>
    </evaluation>`;
    const parsed = parseTaskFile(xml, "suite");
    expect(parsed.map((task) => task.id)).toEqual(["dup", "dup"]);
    // loadTasks is where the throw lives; parseTaskFile stays pure.
  });
});

describe("non-existence probes stay anchored to their tasks", () => {
  // Without this, renaming a slug in the task file would leave the probe
  // guarding an identifier nobody uses — a check that runs and proves nothing.
  it("each probe identifier still appears in its owning task", async () => {
    const { tasks, skipped } = await loadTasks(TASKS_DIR);
    const all = [...tasks, ...skipped];
    for (const probe of NON_EXISTENCE_PROBES) {
      const task = all.find((candidate) => candidate.id === probe.taskId);
      expect(task, `no task with id ${probe.taskId}`).toBeDefined();
      const text = [task!.question, task!.rubric, task!.precondition, task!.why]
        .filter(Boolean)
        .join("\n");
      expect(
        text,
        `${probe.taskId} no longer mentions ${probe.identifier}; the probe now guards nothing`,
      ).toContain(probe.identifier);
    }
  });

  it("both probes are runnable, not skipped", async () => {
    // They were skipped before <precondition> existed, which silently removed
    // half the suite's fabrication measurement.
    const { tasks } = await loadTasks(TASKS_DIR);
    for (const probe of NON_EXISTENCE_PROBES) {
      expect(
        tasks.some((task) => task.id === probe.taskId),
        `${probe.taskId} is not runnable`,
      ).toBe(true);
    }
  });
});
