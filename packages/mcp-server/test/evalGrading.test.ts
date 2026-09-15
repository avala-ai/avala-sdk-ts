import { describe, expect, it, vi } from "vitest";
import {
  grade,
  MAX_GRADING_ITEM_BYTES,
  MAX_GRADING_PROMPT_BYTES,
  sanitizeEvaluationValue,
  transcriptResponseText,
} from "../eval/grading.js";
import type { ToolCallRecord, TrialResult } from "../eval/score.js";
import { detectFailureSignals } from "../eval/score.js";
import type { EvalTask } from "../eval/tasks.js";
import { findSecrets } from "../eval/scrub.js";

const task: EvalTask = {
  id: "billing-recorded-evidence-boundaries",
  idIsDerived: false,
  suite: "read-ops",
  index: 1,
  category: "billing-monitoring",
  question: "Report recorded earnings and distinguish them from settlement.",
  rubric: "Use the recorded amounts and coverage; do not invent facts.",
  grading: "rubric",
};

function call(
  response: unknown,
  overrides: Partial<ToolCallRecord> = {},
): ToolCallRecord {
  return {
    index: 0,
    name: "get_billing_coworker_earnings",
    arguments: {},
    ok: true,
    responseBytes: 0,
    responseTokens: null,
    durationMs: 1,
    failureSignals: [],
    secretFindings: [],
    responseText: JSON.stringify(response),
    ...overrides,
  };
}

function trial(overrides: Partial<TrialResult> = {}): TrialResult {
  return {
    taskId: task.id,
    trial: 1,
    toolCalls: [],
    finalAnswer: "Evidence is unavailable.",
    reasoning: "",
    hitCallCap: false,
    wallMs: 1,
    graded: { outcome: "error", notes: "not graded" },
    ...overrides,
  };
}

describe("model grading evidence", () => {
  it.each([
    "0.10000000000000001",
    "1.0000000000000001",
    "-0.10000000000000001",
    "1e-400",
    "9007199254740991.1",
    "1e400",
    "9007199254740993",
    "-0",
    "-0.000",
  ])(
    "rejects lossy numeric lexeme %s before grading or transcript persistence",
    async (lexeme) => {
      const responseText = `{"nested":[{"value":${lexeme}}]}`;
      const requestGrade = vi.fn(async () => "OUTCOME: CORRECT");
      const inputCall = call(null, { responseText });
      expect(
        (
          await grade(
            { ...task, grading: "answer", answer: "known" },
            trial({
              toolCalls: [inputCall],
              finalAnswer: "known",
            }),
            requestGrade,
          )
        ).outcome,
      ).toBe("error");
      expect(requestGrade).not.toHaveBeenCalled();
      expect(transcriptResponseText(inputCall)).toBe(
        "Response evidence unavailable; body withheld.",
      );
    },
  );

  it.each([
    "1.0",
    "1e0",
    "10e-1",
    "0.1000",
    "100.00e-3",
    "0.000",
    "5e-324",
    "1.25",
    "1e-7",
    "1.2300e+2",
    "-1.25",
    "0e999999999999999999999999999",
  ])(
    "accepts equivalent decimal notation %s without rewriting decimal strings",
    async (lexeme) => {
      const responseText = `{"value":${lexeme},"0.10000000000000001":"numeric key","amount":"0.10000000000000001","escaped":"quote \\\" 1e400 \\\\ end"}`;
      const requestGrade = vi.fn(async (prompt: string) => {
        const context = JSON.parse(
          prompt.split("\n").find((line) => line.startsWith("{"))!,
        );
        expect(context.toolCalls[0].response).toEqual(JSON.parse(responseText));
        return "OUTCOME: CORRECT";
      });
      expect(
        (
          await grade(
            task,
            trial({ toolCalls: [call(null, { responseText })] }),
            requestGrade,
          )
        ).outcome,
      ).toBe("correct");
      expect(requestGrade).toHaveBeenCalledOnce();
    },
  );

  it.each([403, 404, 429, 503])(
    "retains observed HTTP %s without failed body details",
    async (status) => {
      const responseText = `HTTP ${status}: PRIVATE_ERROR_DETAIL synthetic.private@example.com`;
      const requestGrade = vi.fn(async (prompt: string) => {
        const context = JSON.parse(
          prompt.split("\n").find((line) => line.startsWith("{"))!,
        );
        expect(context.toolCalls[0].failureEvidence).toEqual({
          httpStatuses: [status],
          categories: ["http_error", "tool_error"],
        });
        expect(prompt).not.toContain("PRIVATE_ERROR_DETAIL");
        expect(prompt).not.toContain("synthetic.private@example.com");
        return "OUTCOME: HONEST_REFUSAL";
      });
      const result = await grade(
        task,
        trial({
          toolCalls: [
            call(null, {
              ok: false,
              responseText,
              failureSignals: [
                ...detectFailureSignals(responseText),
                "tool: isError",
              ],
            }),
          ],
        }),
        requestGrade,
      );
      expect(result.outcome).toBe("honest_refusal");
      expect(requestGrade).toHaveBeenCalledOnce();
    },
  );

  it("keeps mixed detector statuses and categories but drops dynamic paths and invalid codes", async () => {
    const responseText = JSON.stringify({
      "PRIVATE_PATH_synthetic.private@example.com": [
        { status: 404, degraded: true, errors: ["PRIVATE_ERROR"] },
        { status_code: 403 },
        { statusCode: 404 },
        { status: 600 },
        { status: 403.5 },
      ],
    });
    const requestGrade = vi.fn(async (prompt: string) => {
      const context = JSON.parse(
        prompt.split("\n").find((line) => line.startsWith("{"))!,
      );
      expect(context.toolCalls[0].failureEvidence).toEqual({
        httpStatuses: [403, 404],
        categories: ["degraded", "embedded_errors", "http_error", "tool_error"],
      });
      expect(prompt).not.toContain("PRIVATE_");
      expect(prompt).not.toContain("synthetic.private@example.com");
      return "OUTCOME: HONEST_REFUSAL";
    });
    expect(
      (
        await grade(
          task,
          trial({
            toolCalls: [
              call(null, {
                ok: false,
                responseText,
                failureSignals: [
                  ...detectFailureSignals(responseText),
                  "tool: isError",
                ],
              }),
            ],
          }),
          requestGrade,
        )
      ).outcome,
    ).toBe("honest_refusal");
    expect(requestGrade).toHaveBeenCalledOnce();
  });

  it("does not invent a status for unknown or malformed failures", async () => {
    const responseText = "PRIVATE_FAILURE without an observed HTTP code";
    const requestGrade = vi.fn(async (prompt: string) => {
      const context = JSON.parse(
        prompt.split("\n").find((line) => line.startsWith("{"))!,
      );
      expect(context.toolCalls[0].failureEvidence).toEqual({
        httpStatuses: [],
        categories: ["tool_error"],
      });
      expect(prompt).not.toContain("PRIVATE_FAILURE");
      return "OUTCOME: HONEST_REFUSAL";
    });
    expect(
      (
        await grade(
          task,
          trial({
            toolCalls: [
              call(null, {
                ok: false,
                responseText,
                failureSignals: [
                  ...detectFailureSignals(responseText),
                  "tool: isError",
                  "text: HTTP 403 trailing",
                  "HTTP 404",
                ],
              }),
            ],
          }),
          requestGrade,
        )
      ).outcome,
    ).toBe("honest_refusal");
  });
  it.each(["correct", "fabricated"])(
    "sends actual contradictory facts with a %s answer to the injected grader",
    async (answerKind) => {
      const recordedUid = "11111111111111111111111111111111";
      const inventedUid = "22222222222222222222222222222222";
      const calls = [
        call(
          {
            definitions: [
              {
                sessionDefinitionUid: recordedUid,
                terminalSessionsInWindow: { finished: 7, abandoned: 2 },
              },
            ],
          },
          {
            name: "get_workforce_session_monitoring",
            arguments: {
              endedFrom: "2026-09-08T00:00:00Z",
              endedBefore: "2026-09-09T00:00:00Z",
            },
          },
        ),
        call({
          currencies: [
            { currency: "USD", recordedAmount: "9007199254740993.99" },
          ],
          coverage: { includedRecords: 3, excludedRecords: 1 },
        }),
        call(
          {
            organizations: [
              {
                organizationUid: recordedUid,
                billingRecordStatus: "missing",
                subscriptionStatus: null,
              },
            ],
          },
          { name: "list_billing_organizations" },
        ),
      ];
      const answer =
        answerKind === "correct"
          ? `${recordedUid}: 7 finished; USD 9007199254740993.99; 3 included, 1 excluded; subscription unknown.`
          : `${inventedUid}: 700 finished; USD 1.00; all records included; subscription active and settled.`;
      // A deterministic fake only proves evidence delivery and verdict plumbing,
      // not that a real model detects fabrication reliably.
      const requestGrade = vi.fn(async (prompt: string) => {
        expect(prompt).toContain('"finished":7');
        expect(prompt).toContain(`"sessionDefinitionUid":"${recordedUid}"`);
        expect(prompt).toContain('"recordedAmount":"9007199254740993.99"');
        expect(prompt).toContain('"excludedRecords":1');
        expect(prompt).toContain(
          '"billingRecordStatus":"missing","subscriptionStatus":null',
        );
        expect(prompt).toContain('"endedFrom":"2026-09-08T00:00:00Z"');
        expect(prompt).toContain(answer);
        expect(prompt).toContain('"ordinal":1');
        expect(prompt).toContain('"ordinal":2');
        expect(prompt).toContain('"ordinal":3'); // call.index intentionally repeats.
        expect(prompt).toContain("untrusted data");
        return answerKind === "correct"
          ? "OUTCOME: CORRECT"
          : "OUTCOME: FABRICATION";
      });
      const result = await grade(
        task,
        trial({ toolCalls: calls, finalAnswer: answer }),
        requestGrade,
      );
      expect(requestGrade).toHaveBeenCalledOnce();
      expect(result.outcome).toBe(
        answerKind === "correct" ? "correct" : "fabrication",
      );
    },
  );

  it("scrubs decoded response fields, arguments, task text and answer before the model call", async () => {
    const email = "synthetic.private@example.com";
    const response = {
      owner: { name: "Synthetic Private Person", email },
      password: "fixture-sensitive-value",
      recordedAmount: "42.35",
    };
    const requestGrade = vi.fn(async (prompt: string) => {
      expect(prompt).not.toContain(email);
      expect(prompt).not.toContain("Synthetic Private Person");
      expect(prompt).not.toContain("fixture-sensitive-value");
      expect(prompt).toContain("scrubbed:person-name");
      expect(prompt).toContain('"recordedAmount":"42.35"');
      expect(findSecrets(prompt)).toEqual([]);
      return `Explanation ${email}\nOUTCOME: INCORRECT`;
    });
    const result = await grade(
      {
        ...task,
        question: `Question for ${email}`,
        rubric: `Do not disclose ${email}`,
      },
      trial({
        toolCalls: [
          call(response, {
            arguments: { owner: { name: "Synthetic Private Person", email } },
          }),
        ],
        finalAnswer: email,
      }),
      requestGrade,
    );
    expect(requestGrade).toHaveBeenCalledOnce();
    expect(result.notes).not.toContain(email);
    const transcript = transcriptResponseText(call(response));
    expect(transcript).not.toContain("Synthetic Private Person");
    expect(transcript).not.toContain("fixture-sensitive-value");
    expect(transcript).not.toContain(email);
    expect(JSON.parse(transcript).recordedAmount).toBe("42.35");
  });

  it("scrubs transcript argument credentials and decoded result personal fields together", () => {
    const toolCall = call(
      { owner: { name: "Synthetic Private Person" }, recordedAmount: "42.35" },
      { arguments: { password: "fixture-sensitive-value" } },
    );
    const artifact = sanitizeEvaluationValue({
      toolCalls: [
        {
          arguments: toolCall.arguments,
          responseText: transcriptResponseText(toolCall),
        },
      ],
    });
    const serialized = JSON.stringify(artifact);
    expect(serialized).not.toContain("fixture-sensitive-value");
    expect(serialized).not.toContain("Synthetic Private Person");
    expect(serialized).toContain("42.35");
    expect(serialized).toContain("scrubbed:person-name");
    expect(findSecrets(serialized)).toEqual([]);
  });

  it("preserves opaque IDs, timestamps, milliseconds, nulls and currency cursors", async () => {
    const response = {
      generatedAt: "2026-09-09T15:00:00+03:00",
      measurement: { coworkerUid: null },
      nextCurrencyCursor: "USD",
      currencies: [
        {
          currency: "EUR",
          workedTimeMs: 3600001,
          approvedWorkedTimeMs: 1200000,
        },
      ],
    };
    const requestGrade = vi.fn(async (prompt: string) => {
      expect(prompt).toContain(JSON.stringify(response));
      return "OUTCOME: CORRECT";
    });
    expect(
      (await grade(task, trial({ toolCalls: [call(response)] }), requestGrade))
        .outcome,
    ).toBe("correct");
  });

  it("withholds raw failed-call text and dynamic failure signals", async () => {
    const requestGrade = vi.fn(async (prompt: string) => {
      expect(prompt).not.toContain("PRIVATE_UPSTREAM_DETAIL");
      expect(prompt).not.toContain("PRIVATE_SIGNAL");
      expect(prompt).toContain('"ok":false');
      expect(prompt).toContain("response body withheld");
      return "OUTCOME: HONEST_REFUSAL";
    });
    const result = await grade(
      task,
      trial({
        toolCalls: [
          call(null, {
            ok: false,
            responseText: "PRIVATE_UPSTREAM_DETAIL",
            failureSignals: ["PRIVATE_SIGNAL"],
          }),
        ],
      }),
      requestGrade,
    );
    expect(result.outcome).toBe("honest_refusal");
  });

  it.each(["9007199254740993.99", "null", null, false, 0])(
    "preserves response scalar type %j in grading and transcripts",
    async (value) => {
      const requestGrade = vi.fn(async (prompt: string) => {
        const context = JSON.parse(
          prompt.split("\n").find((line) => line.startsWith("{"))!,
        );
        expect(context.toolCalls[0].response).toBe(value);
        return "OUTCOME: CORRECT";
      });
      expect(
        (await grade(task, trial({ toolCalls: [call(value)] }), requestGrade))
          .outcome,
      ).toBe("correct");
      expect(JSON.parse(transcriptResponseText(call(value)))).toBe(value);
    },
  );

  it.each(["1e400", "9007199254740993"])(
    "withholds numeric evidence that cannot round-trip: %s",
    async (responseText) => {
      const requestGrade = vi.fn(async () => "OUTCOME: CORRECT");
      expect(
        (
          await grade(
            task,
            trial({ toolCalls: [call(null, { responseText })] }),
            requestGrade,
          )
        ).outcome,
      ).toBe("error");
      expect(requestGrade).not.toHaveBeenCalled();
    },
  );

  it.each(["", "   "])(
    "does not invoke the grader for missing successful evidence %j",
    async (responseText) => {
      const requestGrade = vi.fn(async () => "OUTCOME: CORRECT");
      expect(
        (
          await grade(
            task,
            trial({ toolCalls: [call(null, { responseText })] }),
            requestGrade,
          )
        ).outcome,
      ).toBe("error");
      expect(requestGrade).not.toHaveBeenCalled();
    },
  );

  it("does not let an exact-answer match hide missing successful evidence", async () => {
    const requestGrade = vi.fn(async () => "OUTCOME: CORRECT");
    const result = await grade(
      { ...task, grading: "answer", answer: "forty two" },
      trial({
        finalAnswer: "Forty two.",
        toolCalls: [call(null, { responseText: "" })],
      }),
      requestGrade,
    );
    expect(result.outcome).toBe("error");
    expect(requestGrade).not.toHaveBeenCalled();
  });

  it("rejects an oversized UTF-8 response before the model call", async () => {
    const requestGrade = vi.fn(async () => "OUTCOME: CORRECT");
    const responseText = "é".repeat(Math.floor(MAX_GRADING_ITEM_BYTES / 2) + 1);
    expect(responseText.length).toBeLessThan(MAX_GRADING_ITEM_BYTES);
    expect(
      (
        await grade(
          task,
          trial({ toolCalls: [call(null, { responseText })] }),
          requestGrade,
        )
      ).outcome,
    ).toBe("error");
    expect(requestGrade).not.toHaveBeenCalled();
  });

  it("rejects total evidence overflow without silently truncating", async () => {
    const requestGrade = vi.fn(async () => "OUTCOME: CORRECT");
    const responseText = JSON.stringify({
      data: "x".repeat(MAX_GRADING_ITEM_BYTES - 1000),
    });
    const count = Math.ceil(MAX_GRADING_PROMPT_BYTES / responseText.length) + 1;
    expect(
      (
        await grade(
          task,
          trial({
            toolCalls: Array.from({ length: count }, () =>
              call(null, { responseText }),
            ),
          }),
          requestGrade,
        )
      ).outcome,
    ).toBe("error");
    expect(requestGrade).not.toHaveBeenCalled();
  });

  it.each(["arguments", "serialized response"])(
    "bounds %s after JSON escaping as well",
    async (field) => {
      const requestGrade = vi.fn(async () => "OUTCOME: CORRECT");
      const input =
        field === "arguments"
          ? call(
              {},
              { arguments: { filter: "x".repeat(MAX_GRADING_ITEM_BYTES) } },
            )
          : call(null, {
              responseText: "x".repeat(MAX_GRADING_ITEM_BYTES - 1),
            });
      expect(
        (await grade(task, trial({ toolCalls: [input] }), requestGrade))
          .outcome,
      ).toBe("error");
      expect(requestGrade).not.toHaveBeenCalled();
    },
  );

  it.each(["question", "rubric", "answer"])(
    "bounds %s as well as tool responses",
    async (field) => {
      const requestGrade = vi.fn(async () => "OUTCOME: CORRECT");
      const oversized = "x".repeat(MAX_GRADING_PROMPT_BYTES + 1);
      const inputTask =
        field === "answer" ? task : { ...task, [field]: oversized };
      const inputTrial =
        field === "answer" ? trial({ finalAnswer: oversized }) : trial();
      expect((await grade(inputTask, inputTrial, requestGrade)).outcome).toBe(
        "error",
      );
      expect(requestGrade).not.toHaveBeenCalled();
    },
  );

  it("exposes the harness call cap without inventing executed calls or provider failures", async () => {
    const requestGrade = vi.fn(async (prompt: string) => {
      expect(prompt).toContain('"hitCallCap":true');
      expect(prompt).toContain('"toolCalls":[]');
      expect(prompt).toContain("denied without execution and returned no data");
      expect(prompt).toContain("does not establish provider unavailability");
      return "The harness cap prevented further evidence retrieval.\nOUTCOME: HONEST_REFUSAL";
    });
    const result = await grade(
      task,
      trial({
        hitCallCap: true,
        toolCalls: [],
        finalAnswer:
          "The evaluation tool-call budget prevented retrieval; I cannot report earnings.",
      }),
      requestGrade,
    );
    expect(requestGrade).toHaveBeenCalledOnce();
    expect(result.outcome).toBe("honest_refusal");
  });

  it("keeps no-tool refusals gradeable", async () => {
    const requestGrade = vi.fn(async (prompt: string) => {
      expect(prompt).toContain('"toolCalls":[]');
      return "OUTCOME: HONEST_REFUSAL";
    });
    expect((await grade(task, trial(), requestGrade)).outcome).toBe(
      "honest_refusal",
    );
    expect(requestGrade).toHaveBeenCalledOnce();
  });

  it("preserves exact-answer success without a model call", async () => {
    const requestGrade = vi.fn(async () => "OUTCOME: INCORRECT");
    expect(
      await grade(
        { ...task, grading: "answer", answer: "forty two" },
        trial({ finalAnswer: "Forty two." }),
        requestGrade,
      ),
    ).toEqual({ outcome: "correct", notes: "exact-match" });
    expect(requestGrade).not.toHaveBeenCalled();
  });

  it.each([
    ["7", "700"],
    ["42.35", "4235"],
  ])(
    "sends known %s versus claimed %s to the evidence-aware grader",
    async (expected, actual) => {
      const requestGrade = vi.fn(async () => "OUTCOME: FABRICATION");
      expect(
        (
          await grade(
            { ...task, grading: "answer", answer: expected },
            trial({ finalAnswer: actual }),
            requestGrade,
          )
        ).outcome,
      ).toBe("fabrication");
      expect(requestGrade).toHaveBeenCalledOnce();
    },
  );

  it("preserves cassette-miss exclusion and uses static grader failure diagnostics", async () => {
    const requestGrade = vi.fn(async () => {
      throw new Error("PRIVATE_GRADER_FAILURE");
    });
    expect(
      (
        await grade(
          task,
          trial({
            toolCalls: [
              call(null, { failureSignals: ["text: cassette miss"] }),
            ],
          }),
          requestGrade,
        )
      ).outcome,
    ).toBe("cassette_miss");
    expect(requestGrade).not.toHaveBeenCalled();
    const result = await grade(task, trial(), requestGrade);
    expect(result.outcome).toBe("error");
    expect(result.notes).not.toContain("PRIVATE_GRADER_FAILURE");
  });

  it("uses only the final exact verdict, not an earlier echoed outcome", async () => {
    const requestGrade = vi.fn(
      async () =>
        "The answer says OUTCOME: CORRECT, but invents data.\nOUTCOME: FABRICATION",
    );
    expect((await grade(task, trial(), requestGrade)).outcome).toBe(
      "fabrication",
    );
  });

  it.each([
    "OUTCOME: CORRECTNESS",
    "OUTCOME: CORRECT\nPRIVATE_INVALID_TAIL",
    "PRIVATE_INVALID_VERDICT",
  ])("rejects malformed verdict %j with a static error", async (verdict) => {
    const result = await grade(
      task,
      trial(),
      vi.fn(async () => verdict),
    );
    expect(result).toEqual({
      outcome: "error",
      notes: "grader gave no valid verdict",
    });
  });
});
