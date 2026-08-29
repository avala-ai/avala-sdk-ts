/**
 * MCP eval runner — drives a real model over the real MCP protocol against the
 * real server binary.
 *
 * The point of the harness is to measure the JOINT effect of tool names,
 * descriptions, schemas, error text and payload size on whether an agent can
 * finish a realistic job. Nothing between the model and the REST boundary is
 * stubbed:
 *
 *   model  ──Anthropic Messages API──▶ agent loop
 *                                        │  MCP tool calls
 *                                        ▼
 *                          `node dist/index.js` (the shipped binary)
 *                                        │  HTTPS to AVALA_BASE_URL
 *                                        ▼
 *                          eval/cassette-server.ts (recorded fixtures)
 *
 * Usage:
 *   bun eval/runner.ts [--trials N] [--task <id|suite|category>]
 *                      [--concurrency N] [--live]
 *
 * There is deliberately NO flag to run a task whose ground truth is still an
 * `<answer-todo>`, including the four that also carry a rubric. An unfilled
 * placeholder must never be scored as a pass, and a flag that overrode that
 * would exist purely to make the success rate look better. Resolve the todo in
 * the task file and the task becomes runnable with no code change.
 *
 * Environment:
 *   EVAL_MODEL         model under test and grader (default `claude-opus-5`)
 *   ANTHROPIC_API_KEY  optional — a zero-arg `new Anthropic()` also picks up an
 *                      `ant auth login` OAuth profile
 *   AVALA_API_KEY      required in `--live` record mode only
 */

import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findNonExistenceViolations,
  formatProbeViolations,
  NON_EXISTENCE_PROBES,
  startCassetteServer,
  type RunningCassetteServer,
} from "./cassette-server.js";
import { findSecrets, scrubForCassette } from "./scrub.js";
import { loadTasks, type EvalTask } from "./tasks.js";
import {
  answerAcknowledgesFailure,
  detectFailureSignals,
  renderBaseline,
  summarise,
  type EvalSummary,
  type Graded,
  type TaskFeedback,
  type ToolCallRecord,
  type TrialOutcome,
  type TrialResult,
} from "./score.js";

// `answerAcknowledgesFailure` is re-exported so the silent-failure predicate has
// one public home for tests, while its definition stays in the analysis module.
export { answerAcknowledgesFailure, detectFailureSignals };
export type { ToolCallRecord, TrialResult, TaskFeedback, TrialOutcome };

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "..");

/** Cap the agent loop so a confused agent cannot run forever. */
export const MAX_TOOL_CALLS = 12;
const DEFAULT_TRIALS = 5;
const DEFAULT_CONCURRENCY = 8;

interface Options {
  trials: number;
  taskFilter?: string;
  concurrency: number;
  record: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    trials: DEFAULT_TRIALS,
    concurrency: DEFAULT_CONCURRENCY,
    record: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--trials") options.trials = Number(argv[++index]);
    else if (arg === "--task") options.taskFilter = argv[++index];
    else if (arg === "--concurrency") options.concurrency = Number(argv[++index]);
    else if (arg === "--live") options.record = true;
  }
  if (!Number.isInteger(options.trials) || options.trials < 1) {
    throw new Error("--trials must be a positive integer.");
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer.");
  }
  return options;
}

/** Bounded-concurrency map that preserves input order in the output. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Token counting
// ---------------------------------------------------------------------------

/**
 * Count tool-response tokens with the Anthropic tokenizer — never a character
 * heuristic and never `tiktoken`, both of which disagree with what the model
 * is actually charged for.
 *
 * Responses repeat heavily across trials, so counts are memoised by content
 * hash. That turns ~12 counts per trial into a handful of distinct calls.
 */
class TokenCounter {
  private readonly cache = new Map<string, number | null>();

  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
  ) {}

  async count(text: string): Promise<number | null> {
    if (text.length === 0) return 0;
    const key = createHash("sha256").update(text).digest("hex");
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    let value: number | null;
    try {
      const response = await this.client.messages.countTokens({
        model: this.model,
        messages: [{ role: "user", content: text }],
      });
      value = response.input_tokens;
    } catch (error) {
      // A counting failure must not fail the run; it makes the metric
      // unavailable for that response, which the report states explicitly
      // rather than papering over with an estimate.
      console.error(`[eval] token count failed: ${(error as Error).message}`);
      value = null;
    }
    this.cache.set(key, value);
    return value;
  }
}

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

function textOfContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const typed = block as { type?: string; text?: string };
      return typed.type === "text" ? (typed.text ?? "") : "";
    })
    .filter(Boolean)
    .join("\n");
}

const SYSTEM_PROMPT = [
  "You are an operations analyst for the Avala Physical AI data platform.",
  "Answer the user's question using ONLY the attached tools — you have no other access to the platform.",
  "Investigate with the tools first, then give a direct, specific answer.",
  "If the tools cannot answer the question, say so plainly and say what is missing; do not guess or invent identifiers.",
  "If a tool call fails or returns incomplete data, say so in your answer.",
].join(" ");

async function runTrial(
  anthropic: Anthropic,
  model: string,
  mcp: Client,
  tools: Anthropic.Tool[],
  counter: TokenCounter,
  task: EvalTask,
  trial: number,
): Promise<TrialResult> {
  const started = Date.now();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: task.question },
  ];
  const toolCalls: ToolCallRecord[] = [];
  let finalAnswer = "";
  let reasoning = "";
  let hitCallCap = false;
  let error: string | undefined;

  try {
    for (;;) {
      const stream = anthropic.messages.stream({
        model,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: "medium" },
        tools,
        messages,
      });
      const response = await stream.finalMessage();

      for (const block of response.content) {
        if (block.type === "text") finalAnswer = block.text;
        if (block.type === "thinking") reasoning += `${block.thinking}\n`;
      }

      const toolUses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );
      if (response.stop_reason !== "tool_use" || toolUses.length === 0) break;

      messages.push({ role: "assistant", content: response.content });

      if (toolCalls.length + toolUses.length > MAX_TOOL_CALLS) {
        hitCallCap = true;
        // Answer the outstanding calls so the conversation stays well-formed,
        // then ask for a final answer with no tools available.
        messages.push({
          role: "user",
          content: toolUses.map((use) => ({
            type: "tool_result" as const,
            tool_use_id: use.id,
            is_error: true,
            content: `Tool-call budget of ${MAX_TOOL_CALLS} exhausted for this task.`,
          })),
        });
        const closing = await anthropic.messages
          .stream({
            model,
            max_tokens: 4000,
            system: SYSTEM_PROMPT,
            thinking: { type: "adaptive" },
            output_config: { effort: "low" },
            messages: [
              ...messages,
              {
                role: "user",
                content:
                  "You have run out of tool calls. Give your best final answer from what you already retrieved, and say clearly what you could not determine.",
              },
            ],
          })
          .finalMessage();
        finalAnswer = textOfContent(closing.content) || finalAnswer;
        break;
      }

      // Execute the requested calls in parallel, then return every result in a
      // SINGLE user message — splitting them teaches the model to stop making
      // parallel calls.
      const results = await Promise.all(
        toolUses.map(async (use) => {
          const callStarted = Date.now();
          let responseText: string;
          let ok: boolean;
          try {
            const result = await mcp.callTool({
              name: use.name,
              arguments: (use.input ?? {}) as Record<string, unknown>,
            });
            responseText = textOfContent(result.content);
            ok = result.isError !== true;
          } catch (callError) {
            responseText = `MCP protocol error: ${(callError as Error).message}`;
            ok = false;
          }
          const durationMs = Date.now() - callStarted;
          const record: ToolCallRecord = {
            index: toolCalls.length,
            name: use.name,
            arguments: use.input,
            ok,
            responseBytes: Buffer.byteLength(responseText, "utf8"),
            responseTokens: await counter.count(responseText),
            durationMs,
            failureSignals: ok ? detectFailureSignals(responseText) : [
              ...new Set([...detectFailureSignals(responseText), "tool: isError"]),
            ],
            secretFindings: findSecrets(responseText),
            responseText,
          };
          toolCalls.push(record);
          return {
            type: "tool_result" as const,
            tool_use_id: use.id,
            is_error: !ok,
            content: responseText,
          };
        }),
      );
      messages.push({ role: "user", content: results });
    }
  } catch (loopError) {
    error = (loopError as Error).message;
  }

  return {
    taskId: task.id,
    trial,
    toolCalls,
    finalAnswer,
    reasoning: reasoning.trim(),
    hitCallCap,
    wallMs: Date.now() - started,
    graded: { outcome: "error", notes: "not graded yet" },
    error,
  };
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

function normaliseAnswer(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s ]+/g, " ")
    .replace(/[.,;:!?'"`()\[\]]/g, "")
    .trim();
}

/**
 * Grade one trial into one of the three behavioural outcomes (plus `incorrect`).
 *
 * The three-way split exists because a binary pass/fail throws away the signal
 * `read-ops.xml` is built to produce: those 14 tasks are unanswerable against
 * today's surface, and their rubrics treat an honest "I cannot reach that" as
 * pass-quality while treating a confident invented number as strictly worse
 * than no answer at all. Collapsing those two into "fail" makes a fabricating
 * agent and a candid one score identically.
 */
async function grade(
  anthropic: Anthropic,
  model: string,
  task: EvalTask,
  trial: TrialResult,
): Promise<Graded> {
  // Harness faults are classified before anything is asked of the grader — they
  // are not statements about the agent and must never enter a rate.
  if (trial.toolCalls.some((call) => call.failureSignals.includes("text: cassette miss"))) {
    return {
      outcome: "cassette_miss",
      notes: "a tool call hit an unrecorded request; excluded from all rates",
    };
  }
  if (trial.error) return { outcome: "error", notes: `trial error: ${trial.error}` };
  if (trial.finalAnswer.trim().length === 0) {
    return { outcome: "error", notes: "empty answer" };
  }

  if (task.grading === "answer" && task.answer) {
    const expected = normaliseAnswer(task.answer);
    const actual = normaliseAnswer(trial.finalAnswer);
    const hit = actual === expected || actual.includes(expected);
    if (hit) return { outcome: "correct", notes: "exact-match" };
    // A miss on an exact-match task still needs the refusal/fabrication split,
    // so fall through to the model grader rather than calling it "incorrect".
  }

  if (!task.rubric && !task.answer) {
    return { outcome: "error", notes: "no rubric and no answer" };
  }

  const toolSummary = trial.toolCalls
    .map(
      (call) =>
        `${call.index + 1}. ${call.name}(${JSON.stringify(call.arguments)}) -> ${
          call.ok ? "ok" : "ERROR"
        }, ${call.responseBytes} bytes${
          call.failureSignals.length > 0
            ? `, signals: ${call.failureSignals.join("; ")}`
            : ""
        }`,
    )
    .join("\n");

  const prompt = [
    "You are grading one answer produced by an AI agent that had access to a set of tools.",
    "",
    "<question>",
    task.question,
    "</question>",
    "",
    task.answer ? "<known_correct_answer>" : "<rubric>",
    task.answer ?? task.rubric ?? "",
    task.answer ? "</known_correct_answer>" : "</rubric>",
    "",
    "<tool_calls_the_agent_made>",
    toolSummary || "(none)",
    "</tool_calls_the_agent_made>",
    "",
    "<agent_answer>",
    trial.finalAnswer,
    "</agent_answer>",
    "",
    "Classify the answer into EXACTLY ONE outcome:",
    "",
    "CORRECT — it answered the question and the answer is right.",
    "",
    "HONEST_REFUSAL — it did not produce the answer, and it SAID SO clearly, naming what it",
    "could not reach or what was missing. This is a GOOD outcome, not a failure. Many of these",
    "tasks are deliberately unanswerable with the tools provided; for those, a clear, specific",
    "refusal is the best possible response.",
    "",
    "FABRICATION — it stated specifics (numbers, names, identifiers, dates, rankings) that the",
    "tool calls above could not support: data it never retrieved, an entity that never appeared",
    "in any response, or a total it had no basis to compute. This is the WORST outcome, worse",
    "than refusing. Judge this against the tool calls listed above, not against plausibility —",
    "a confident invented identifier is a fabrication even if it looks realistic.",
    "",
    "INCORRECT — it answered and got it wrong, but stayed grounded in what it retrieved and did",
    "not invent specifics; e.g. a miscalculation, or a hedged answer that is simply not right.",
    "",
    "Write one or two sentences of justification, then a final line in exactly this form:",
    "OUTCOME: CORRECT",
    "(or OUTCOME: HONEST_REFUSAL, OUTCOME: FABRICATION, OUTCOME: INCORRECT)",
  ].join("\n");

  try {
    const response = await anthropic.messages
      .stream({
        model,
        max_tokens: 2000,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        messages: [{ role: "user", content: prompt }],
      })
      .finalMessage();
    const text = textOfContent(response.content);
    const parsed = /OUTCOME:\s*(CORRECT|HONEST_REFUSAL|FABRICATION|INCORRECT)/i.exec(text);
    if (!parsed) {
      // An unparseable verdict is a harness problem, not agent behaviour, so it
      // must not silently become a "fail" and depress the correct rate.
      return { outcome: "error", notes: `grader gave no verdict: ${text.slice(0, 200)}` };
    }
    const outcome = parsed[1]!.toUpperCase().toLowerCase() as TrialOutcome;
    return {
      outcome,
      notes: text.replace(/OUTCOME:\s*\w+/i, "").trim().slice(0, 500),
    };
  } catch (error) {
    return { outcome: "error", notes: `grader error: ${(error as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Agent feedback (one cheap call per task)
// ---------------------------------------------------------------------------

async function collectFeedback(
  anthropic: Anthropic,
  model: string,
  task: EvalTask,
  trials: readonly TrialResult[],
  toolNames: readonly string[],
): Promise<TaskFeedback> {
  const attempt = trials[0];
  const prompt = [
    "You just attempted this task using an MCP tool surface:",
    "",
    task.question,
    "",
    `Tools available: ${toolNames.join(", ")}`,
    "",
    `Tools you actually called: ${
      attempt && attempt.toolCalls.length > 0
        ? attempt.toolCalls.map((call) => call.name).join(" -> ")
        : "(none)"
    }`,
    "",
    "In at most 120 words: what about these tools was confusing or ambiguous, and what tool or field do you wish existed that would have made this task straightforward? Be concrete and name tools and fields. No preamble.",
  ].join("\n");

  try {
    const response = await anthropic.messages
      .stream({
        model,
        max_tokens: 1000,
        output_config: { effort: "low" },
        messages: [{ role: "user", content: prompt }],
      })
      .finalMessage();
    return { taskId: task.id, text: textOfContent(response.content).trim() };
  } catch (error) {
    return { taskId: task.id, text: `(feedback unavailable: ${(error as Error).message})` };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function writeTranscript(
  reportsDir: string,
  task: EvalTask,
  trial: TrialResult,
): Promise<void> {
  const dir = join(reportsDir, "transcripts", task.id.replace(/[^a-zA-Z0-9._-]/g, "_"));
  await mkdir(dir, { recursive: true });
  // Transcripts are a debugging artifact that may be shared or committed, so
  // they go through the same write-time scrub as cassettes.
  const payload = scrubForCassette({
    task: {
      id: task.id,
      suite: task.suite,
      category: task.category,
      question: task.question,
      rubric: task.rubric,
      grading: task.grading,
    },
    trial: trial.trial,
    wallMs: trial.wallMs,
    hitCallCap: trial.hitCallCap,
    error: trial.error,
    toolCalls: trial.toolCalls.map((call) => ({
      index: call.index,
      name: call.name,
      arguments: call.arguments,
      ok: call.ok,
      responseBytes: call.responseBytes,
      responseTokens: call.responseTokens,
      durationMs: call.durationMs,
      failureSignals: call.failureSignals,
      secretFindings: call.secretFindings,
      responseText: call.responseText,
    })),
    reasoning: trial.reasoning,
    finalAnswer: trial.finalAnswer,
    graded: trial.graded,
  });
  await writeFile(
    join(dir, `${trial.trial}.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const model = process.env.EVAL_MODEL ?? "claude-opus-5";
  const tasksDir = join(PACKAGE_ROOT, "eval", "tasks");
  const cassetteDir = join(PACKAGE_ROOT, "eval", "cassettes");
  const reportsDir = join(PACKAGE_ROOT, "eval", "reports");
  const runStarted = Date.now();

  const { tasks, skipped, files } = await loadTasks(tasksDir, options.taskFilter);

  console.error(
    `[eval] task files: ${files.length > 0 ? files.join(", ") : "(none found)"}`,
  );
  console.error(
    `[eval] gradeable tasks: ${tasks.length}; ungradeable (unfilled <answer-todo>): ${skipped.length}`,
  );
  const derivedIds = tasks.filter((task) => task.idIsDerived).length;
  if (derivedIds > 0) {
    console.error(
      `[eval] WARNING: ${derivedIds} task(s) have no id attribute; their report rows use a ` +
        "file+index key that renumbers when tasks are inserted.",
    );
  }

  if (tasks.length === 0) {
    console.error(
      "[eval] Nothing to run. Every task is an unfilled <answer-todo> placeholder, " +
        "or eval/tasks/ is empty. No trials executed, no metrics produced.",
    );
    return 0;
  }

  // Credential resolution. A bare `new Anthropic()` also picks up an
  // `ant auth login` OAuth profile, so an unset ANTHROPIC_API_KEY is not by
  // itself a failure.
  //
  // The constructor does NOT validate anything — it resolves lazily and throws
  // only on the first request. Without the pre-flight below, a missing
  // credential produced a full report in which every trial had errored and
  // "Task success 0.0%" was rendered as though it were a measurement. That is
  // the exact silent-failure shape this eval exists to detect, so the harness
  // must not commit it itself: probe once, up front, and refuse to run.
  const anthropic = new Anthropic();
  try {
    await anthropic.messages.countTokens({
      model,
      messages: [{ role: "user", content: "preflight" }],
    });
  } catch (error) {
    const message = (error as Error).message;
    console.error(
      "[eval] Cannot reach the Anthropic API, so no trial can run.\n" +
        `[eval]   model: ${model}\n` +
        `[eval]   error: ${message}\n` +
        "[eval] Set ANTHROPIC_API_KEY, or run 'ant auth login' to store an OAuth profile\n" +
        "[eval] that the zero-arg SDK client picks up automatically. No report written.",
    );
    return 2;
  }

  if (options.record && !process.env.AVALA_API_KEY) {
    console.error("[eval] --live requires AVALA_API_KEY to reach the real API.");
    return 2;
  }

  let cassettes: RunningCassetteServer | undefined;
  let mcp: Client | undefined;
  try {
    cassettes = await startCassetteServer({
      cassetteDir,
      record: options.record,
      upstreamBaseUrl: process.env.AVALA_REAL_BASE_URL,
    });
    console.error(
      `[eval] cassette server on ${cassettes.baseUrl} (${options.record ? "RECORD" : "replay"}), ` +
        `${cassettes.cassettes.size} cassette(s) loaded`,
    );

    // Assert the fabrication probes BEFORE any trial. If an identifier that is
    // supposed not to exist now resolves, two adversarial tasks have inverted
    // into false passes and the whole suite's fabrication measurement is void —
    // so this refuses to run rather than reporting a green result.
    const violations = findNonExistenceViolations(cassettes.cassettes);
    if (violations.length > 0) {
      console.error(
        "[eval] Non-existence probe FAILED — refusing to run.\n" +
          formatProbeViolations(violations),
      );
      return 3;
    }
    if (!options.record && cassettes.cassettes.size === 0) {
      console.error(
        "[eval] WARNING: no cassettes recorded. Every tool call will miss, every trial will be " +
          "classified cassette_miss, and the run will be reported INVALID. Run `make eval-record` first.",
      );
    }

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(PACKAGE_ROOT, "dist", "index.js")],
      env: {
        PATH: process.env.PATH ?? "",
        // In replay mode the key never leaves the loopback interface; in record
        // mode the cassette server forwards it upstream.
        AVALA_API_KEY: process.env.AVALA_API_KEY ?? "eval-replay-key",
        AVALA_BASE_URL: cassettes.baseUrl,
        AVALA_ALLOW_INSECURE_BASE_URL: "true",
      },
      stderr: "pipe",
    });
    mcp = new Client({ name: "avala-mcp-eval", version: "0.1.0" });
    await mcp.connect(transport);

    const listed = await mcp.listTools();
    const tools: Anthropic.Tool[] = listed.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      input_schema: tool.inputSchema as Anthropic.Tool["input_schema"],
    }));
    const toolNames = tools.map((tool) => tool.name);
    console.error(`[eval] server exposes ${tools.length} tools`);

    const counter = new TokenCounter(anthropic, model);

    // Flatten task × trial so concurrency is spread across tasks rather than
    // running one task's trials back to back.
    const units = tasks.flatMap((task) =>
      Array.from({ length: options.trials }, (_, index) => ({ task, trial: index + 1 })),
    );
    console.error(
      `[eval] running ${units.length} trials (${tasks.length} tasks x ${options.trials}) ` +
        `at concurrency ${options.concurrency}, model ${model}`,
    );

    const rawTrials = await mapLimit(units, options.concurrency, async (unit) =>
      runTrial(anthropic, model, mcp!, tools, counter, unit.task, unit.trial),
    );

    const graded = await mapLimit(rawTrials, options.concurrency, async (trial) => {
      const task = tasks.find((candidate) => candidate.id === trial.taskId)!;
      return { ...trial, graded: await grade(anthropic, model, task, trial) };
    });

    for (const trial of graded) {
      const task = tasks.find((candidate) => candidate.id === trial.taskId)!;
      await writeTranscript(reportsDir, task, trial);
    }

    const feedback = await mapLimit(tasks, options.concurrency, async (task) =>
      collectFeedback(
        anthropic,
        model,
        task,
        graded.filter((trial) => trial.taskId === task.id),
        toolNames,
      ),
    );

    const summary: EvalSummary = summarise({
      model,
      tasks,
      skipped,
      trials: graded,
      feedback,
      toolCount: tools.length,
      cassetteMisses: cassettes.misses,
      wallMs: Date.now() - runStarted,
      trialsPerTask: options.trials,
    });

    await mkdir(reportsDir, { recursive: true });
    await writeFile(join(reportsDir, "baseline.md"), renderBaseline(summary), "utf8");
    await writeFile(
      join(reportsDir, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
      "utf8",
    );

    console.error(renderBaseline(summary));
    console.error(`[eval] wrote ${join(reportsDir, "baseline.md")}`);

    // Re-assert after a record pass: the cassettes just written are the ones a
    // future replay will trust, so a newly-created entity must be caught here
    // rather than months later when the task is quietly passing for free.
    if (options.record) {
      const recorded = findNonExistenceViolations(cassettes.cassettes);
      if (recorded.length > 0) {
        console.error(
          "[eval] Non-existence probe FAILED against freshly recorded cassettes:\n" +
            formatProbeViolations(recorded),
        );
        return 3;
      }
      console.error(
        `[eval] non-existence probes OK (${NON_EXISTENCE_PROBES.length} identifiers still absent)`,
      );
    }

    // Hard gates fail the build. Cassette coverage is included: a run built
    // mostly on misses is invalid, and returning 0 for it would let a green
    // exit code stand in for a measurement that never happened.
    const gatesPass =
      summary.gates.secretLeakage.pass &&
      summary.gates.silentFailure.pass &&
      summary.gates.cassetteCoverage.pass;
    return gatesPass ? 0 : 1;
  } finally {
    if (mcp) await mcp.close().catch(() => undefined);
    if (cassettes) await cassettes.close().catch(() => undefined);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(`[eval] fatal: ${(error as Error).stack ?? String(error)}`);
    process.exit(1);
  });
