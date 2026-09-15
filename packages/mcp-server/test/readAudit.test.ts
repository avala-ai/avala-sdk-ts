import type { McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enforceEgressScrubbing } from "../src/egress.js";
import {
  observeHostedInvocations,
  type HostedInvocationEvent,
  type InvocationObserver,
} from "../src/readAudit.js";

function instrument(
  handler: (...args: unknown[]) => unknown,
  observer?: InvocationObserver,
): (...args: unknown[]) => unknown {
  let wrapped = handler;
  const stub = {
    registerTool: (_name: string, _config: unknown, next: typeof handler) => {
      wrapped = next;
    },
  } as unknown as McpServer;
  const server = enforceEgressScrubbing(
    observeHostedInvocations(
      stub,
      { credentialKind: "api_key", observer },
      new Set(),
    ),
  );
  server.registerTool("example_read", {}, handler as never);
  return wrapped;
}

afterEach(() => vi.restoreAllMocks());

describe("hosted invocation metadata", () => {
  it("logs only fixed metadata after scrubbing, using a monotonic duration", async () => {
    const events: HostedInvocationEvent[] = [];
    const before = Date.now();
    const clock = vi
      .spyOn(performance, "now")
      .mockReturnValueOnce(50)
      .mockReturnValueOnce(62.9);
    const secret = "reviewer@example.com";
    const result = {
      content: [{ type: "text", text: secret }],
      structuredContent: { items: [{ [secret]: secret }] },
    };
    const call = instrument(
      async () => result,
      (event) => {
        events.push(event);
      },
    );
    const returned = await call({
      query: secret,
      verifiedActorUid: secret,
      organizationUid: secret,
    });
    expect(clock).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      {
        event: "mcp.tool_invocation",
        observedAt: expect.any(String),
        credentialKind: "api_key",
        tool: "example_read",
        operationKind: "read",
        latencyMs: 12,
        outcome: "success",
        attribution: "unknown",
        verifiedActorUid: null,
        resolvedTenant: null,
        resultShape: {
          contentBlocks: 1,
          textCharacters: (returned as typeof result).content[0]!.text.length,
          hasStructuredContent: true,
          items: 1,
          truncated: false,
        },
      },
    ]);
    const observedAt = events[0]!.observedAt;
    expect(new Date(observedAt).toISOString()).toBe(observedAt);
    expect(Date.parse(observedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(observedAt)).toBeLessThanOrEqual(Date.now());
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(JSON.stringify(returned)).not.toContain(secret);
  });

  it.each([false, true])(
    "preserves thrown errors without inspecting them (async=%s)",
    async (asyncHandler) => {
      const failure = new Error("Bearer credential and private query");
      Object.defineProperty(failure, "name", {
        get: () => {
          throw new Error("must not inspect");
        },
      });
      const events: HostedInvocationEvent[] = [];
      const fail = () => {
        throw failure;
      };
      const call = instrument(
        asyncHandler ? async () => fail() : fail,
        (event) => {
          events.push(event);
        },
      );
      if (asyncHandler) await expect(call()).rejects.toBe(failure);
      else expect(call).toThrow(failure);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ outcome: "error", resultShape: null });
      expect(JSON.stringify(events)).not.toContain("private");
    },
  );

  it.each([
    [{ content: [], isError: true }, "error"],
    [
      { structuredContent: { degraded: true, items: [] }, content: [] },
      "degraded",
    ],
    [
      {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              degraded: true,
              unavailable: [{ reason: "private" }],
            }),
          },
        ],
      },
      "degraded",
    ],
    [
      { inputRequests: { private_prompt: {} }, requestState: "secret" },
      "input_required",
    ],
    [
      {
        content: [
          { type: "text", text: "private provider error without isError" },
        ],
      },
      "success",
    ],
    [null, "unknown"],
  ])(
    "classifies returned status without emitting payload values",
    (result, outcome) => {
      const events: HostedInvocationEvent[] = [];
      instrument(
        () => result,
        (event) => {
          events.push(event);
        },
      )();
      expect(events[0]!.outcome).toBe(outcome);
      expect(JSON.stringify(events)).not.toMatch(/private|secret/);
    },
  );

  it("bounds shape inspection and leaves oversized text-only outcome unknown", () => {
    const events: HostedInvocationEvent[] = [];
    const content = Array.from({ length: 1001 }, () => ({
      type: "text",
      text: "x".repeat(1100),
    }));
    instrument(
      () => ({
        content,
        structuredContent: { items: new Array(1001).fill(null) },
      }),
      (event) => {
        events.push(event);
      },
    )();
    instrument(
      () => ({ content: [{ type: "text", text: "x".repeat(65_537) }] }),
      (event) => {
        events.push(event);
      },
    )();
    expect(events[0]!.resultShape).toMatchObject({
      contentBlocks: 1000,
      textCharacters: 1_000_000,
      items: 1000,
      truncated: true,
    });
    expect(events[1]).toMatchObject({
      outcome: "unknown",
      resultShape: { truncated: true },
    });
    expect(JSON.stringify(events).length).toBeLessThan(1200);
  });

  it.each(["throw", "reject"])(
    "observer %s cannot break a successful or failed invocation",
    async (mode) => {
      const observer: InvocationObserver = () => {
        if (mode === "throw") throw new Error("observer secret");
        return Promise.reject(new Error("observer secret"));
      };
      const result = { content: [] };
      expect(instrument(() => result, observer)()).toEqual(result);
      await expect(instrument(async () => result, observer)()).resolves.toEqual(
        result,
      );
      const failure = new Error("provider secret");
      await expect(
        instrument(async () => {
          throw failure;
        }, observer)(),
      ).rejects.toBe(failure);
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  );

  it("defaults to one JSON console line without payload URLs", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const url = "https://bucket.example.com/export?Signature=private";
    instrument(() => ({
      content: [{ type: "text", text: url }],
      structuredContent: { url },
    }))();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]).toHaveLength(1);
    expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({
      event: "mcp.tool_invocation",
      verifiedActorUid: null,
      resolvedTenant: null,
    });
    expect(log.mock.calls[0]![0]).not.toContain(url);
  });
});
