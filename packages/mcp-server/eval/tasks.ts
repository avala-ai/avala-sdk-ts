/**
 * Loader for the XML task files in `eval/tasks/`.
 *
 * The task files are authored separately from this harness. The parser is
 * therefore deliberately tolerant: it reads the elements it knows about, keeps
 * everything else, and never throws on an unexpected sibling element. A missing
 * or empty `eval/tasks/` directory yields zero tasks — the runner reports that
 * and exits cleanly rather than inventing work.
 *
 * Schema, verified against `origin/feat/mcp-eval-tasks` @ 6fab8df6db:
 *
 *     <evaluation>
 *       <qa_pair id="recon-blocked-most-frames">   ← permanent, never reused
 *         <category>…</category>
 *         <question>…</question>
 *         <why>…</why>                             ← prose for humans, not graded
 *         <rubric>…</rubric>                       ← gradeable NOW, complete alone
 *         <answer>…</answer>                       ← ground truth, exact-match
 *         <answer-todo>…</answer-todo>             ← ground truth NOT known
 *         <precondition>…</precondition>           ← build-time fact to verify
 *       </qa_pair>
 *     </evaluation>
 *
 * RUNNABLE = (`<answer>` or `<rubric>`) AND no `<answer-todo>`.
 *
 * `<precondition>` NEVER blocks a run. It carries a fact to check when RECORDING
 * cassettes, not a statement about gradeability. Conflating the two is exactly
 * the bug that used to skip four adversarial tasks — including both
 * does-not-exist probes, which are half the suite's fabrication measurement. The
 * eval was quietly deleting the thing `adversarial.xml` exists to measure.
 *
 * Element ORDER is not guaranteed and unknown elements are ignorable metadata,
 * so nothing here indexes positionally or rejects an unrecognised child.
 *
 * `<answer>` occurs zero times today, so the exact-match path ships unexercised
 * against real tasks (it is unit-tested). Each `<answer-todo>` becomes an
 * `<answer>` once cassettes exist — see `deriveAnswersFromCassettes` guidance in
 * `eval/reports/baseline.md`.
 *
 * COUNTING WARNING: every file opens with a header comment that DOCUMENTS this
 * schema, so a naive `grep -c '<precondition>'` reports 10 where the real answer
 * is 4. Strip comments before counting anything — `stripComments` below is what
 * makes the parser's own counts trustworthy.
 */

import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

export type Grading = "answer" | "rubric" | "skipped-todo";

export interface EvalTask {
  /**
   * The task's permanent `id` attribute. Assigned once and never reused: a
   * reworded task keeps its id, and a deleted task's id is retired. Report rows
   * key on this so a CHANGELOG before/after compares the same task even after
   * tasks are inserted or reworded — a file+index key silently renumbers, and a
   * question-hash key moves on a typo fix.
   */
  readonly id: string;
  /** Set when the file predates the `id` attribute; id then falls back to `<suite>#<index>`. */
  readonly idIsDerived: boolean;
  /** Source file basename without extension, e.g. `read-ops`. */
  readonly suite: string;
  readonly index: number;
  readonly category: string;
  readonly question: string;
  readonly answer?: string;
  readonly rubric?: string;
  readonly why?: string;
  /** Present when ground truth has not been derived yet. Blocks running. */
  readonly answerTodo?: string;
  /**
   * A fact to verify when RECORDING cassettes. Never a gradeability signal and
   * never a reason to skip. Two of these assert an entity does NOT exist; see
   * `NON_EXISTENCE_PROBES` in `cassette-server.ts`.
   */
  readonly precondition?: string;
  readonly grading: Grading;
}

export interface TaskLoadResult {
  readonly tasks: readonly EvalTask[];
  /** Every parsed pair, including the skipped ones, for accurate reporting. */
  readonly skipped: readonly EvalTask[];
  readonly files: readonly string[];
}

/** Strip XML comments so commented-out pairs are never parsed as real ones. */
function stripComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, "");
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&"); // last, so `&amp;lt;` does not become `<`
}

/**
 * Collapse the indentation the task files use for readability while keeping
 * paragraph breaks, so a rubric reads the same to the grader as on disk.
 */
function normaliseText(text: string): string {
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractElement(block: string, name: string): string | undefined {
  const pattern = new RegExp(`<${name}\\s*>([\\s\\S]*?)</${name}\\s*>`, "i");
  const match = pattern.exec(block);
  if (!match) return undefined;
  const text = normaliseText(match[1] ?? "");
  return text.length > 0 ? text : undefined;
}

export function parseTaskFile(xml: string, suite: string): EvalTask[] {
  const source = stripComments(xml);
  const tasks: EvalTask[] = [];
  // `[^>]*` (not `\s*`) so the `id` attribute is matched rather than skipped.
  const pairPattern = /<qa_pair\b([^>]*)>([\s\S]*?)<\/qa_pair\s*>/gi;

  let index = 0;
  for (const match of source.matchAll(pairPattern)) {
    const attributes = match[1] ?? "";
    const block = match[2] ?? "";
    index += 1;

    const question = extractElement(block, "question");
    if (!question) continue; // A pair with no question is not runnable.

    const answer = extractElement(block, "answer");
    const rubric = extractElement(block, "rubric");
    const answerTodo = extractElement(block, "answer-todo");

    // The runnable rule, in one place: gradeable ground truth AND no unfilled
    // placeholder. `<precondition>` is deliberately absent from this decision.
    let grading: Grading;
    if (answerTodo) {
      grading = "skipped-todo";
    } else if (answer) {
      grading = "answer";
    } else if (rubric) {
      grading = "rubric";
    } else {
      grading = "skipped-todo"; // Nothing to grade against.
    }

    const declaredId = /\bid\s*=\s*"([^"]*)"/.exec(attributes)?.[1]?.trim();
    const hasDeclaredId = Boolean(declaredId && declaredId.length > 0);

    tasks.push({
      id: hasDeclaredId ? declaredId! : `${suite}#${index}`,
      idIsDerived: !hasDeclaredId,
      suite,
      index,
      category: extractElement(block, "category") ?? "uncategorised",
      question,
      answer,
      rubric,
      why: extractElement(block, "why"),
      answerTodo,
      precondition: extractElement(block, "precondition"),
      grading,
    });
  }
  return tasks;
}

export async function loadTasks(
  tasksDir: string,
  filter?: string,
): Promise<TaskLoadResult> {
  let entries: string[] = [];
  try {
    entries = (await readdir(tasksDir)).filter((name) => name.endsWith(".xml")).sort();
  } catch {
    return { tasks: [], skipped: [], files: [] };
  }

  const all: EvalTask[] = [];
  for (const entry of entries) {
    const suite = basename(entry, ".xml");
    const xml = await readFile(join(tasksDir, entry), "utf8");
    all.push(...parseTaskFile(xml, suite));
  }

  const matching = filter
    ? all.filter(
        (task) =>
          task.id === filter || task.suite === filter || task.category === filter,
      )
    : all;

  const duplicates = [...new Set(
    all.map((task) => task.id).filter((id, i, ids) => ids.indexOf(id) !== i),
  )];
  if (duplicates.length > 0) {
    // Ids are the report's join key; a duplicate would silently merge two tasks'
    // numbers into one row and make every later comparison wrong.
    throw new Error(
      `Duplicate qa_pair id(s) across eval/tasks: ${duplicates.join(", ")}. ` +
        "Ids must be unique and are never reused.",
    );
  }

  return {
    tasks: matching.filter((task) => task.grading !== "skipped-todo"),
    skipped: matching.filter((task) => task.grading === "skipped-todo"),
    files: entries,
  };
}
