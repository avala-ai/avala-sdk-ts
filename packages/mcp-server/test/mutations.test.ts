import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createMutationConfirmationService,
  defineMutationCatalogTool,
  registerMutationCatalogTool,
} from "../src/mutations.js";

type ToolResult = {
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
  resultType?: string;
  inputRequests?: Record<string, unknown>;
  requestState?: string;
  isError?: boolean;
};

type ToolHandler = (
  args: Record<string, unknown>,
  context: ReturnType<typeof modernContext> | ReturnType<typeof legacyContext>,
) => Promise<ToolResult>;

function modernContext(
  inputResponses?: Record<string, unknown>,
  requestState?: string,
) {
  return {
    mcpReq: {
      envelope: {},
      inputResponses,
      requestState: () => requestState,
      elicitInput: vi.fn(),
    },
  };
}

function legacyContext(confirmed = true) {
  return {
    mcpReq: {
      envelope: undefined,
      inputResponses: undefined,
      requestState: () => undefined,
      elicitInput: vi.fn().mockResolvedValue({
        action: confirmed ? "accept" : "decline",
        content: confirmed ? { confirm: true } : undefined,
      }),
    },
  };
}

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  const configs = new Map<string, Record<string, unknown>>();
  return {
    registerTool: vi.fn(
      (
        name: string,
        config: Record<string, unknown>,
        handler: ToolHandler,
      ) => {
        configs.set(name, config);
        handlers.set(name, handler);
      },
    ),
    getHandler: (name: string) => handlers.get(name),
    getConfig: (name: string) => configs.get(name),
  };
}

const definition = defineMutationCatalogTool({
  name: "set_test_state",
  title: "Set test state",
  description: "Test-only mutation contract.",
  inputSchema: z.object({
    uid: z.string(),
    expectedState: z.string(),
    state: z.string(),
    reason: z.string(),
  }),
  outputSchema: z
    .object({
      uid: z.string(),
      previousState: z.string(),
      state: z.string(),
      reversalGuidance: z.string(),
    })
    .strip(),
  route: {
    name: "test-state",
    method: "POST",
    path: "/test/{uid}/state/",
    scope: "test.write",
    toolset: "staff",
    body: ({ expectedState, state, reason }) => ({
      expected_state: expectedState,
      state,
      reason,
    }),
  },
  preview: ({ uid, expectedState, state }) => ({
    message: `Change ${uid} from ${expectedState} to ${state}?`,
  }),
  reversalGuidance: ({ expectedState }) => `Set the state back to ${expectedState}.`,
});

const args = {
  uid: "item-1",
  expectedState: "before",
  state: "after",
  reason: "Scheduled transition",
};

const acceptedResponse = {
  confirmAvalaMutation: {
    action: "accept",
    content: { confirm: true },
  },
};

describe("mutation confirmation state", () => {
  it("binds approval to exact tool, arguments and credential", () => {
    const service = createMutationConfirmationService("test-key", () => 1_000);
    const state = service.issue("set_test_state", args, "credential-a");

    const idempotencyKey = service.verify(
      state,
      "set_test_state",
      args,
      "credential-a",
    );
    expect(idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(
      service.verify(
        state,
        "set_test_state",
        {
          state: args.state,
          reason: args.reason,
          uid: args.uid,
          expectedState: args.expectedState,
        },
        "credential-a",
      ),
    ).toBe(idempotencyKey);
    for (const [toolName, changedArgs, credential] of [
      ["other_tool", args, "credential-a"],
      ["set_test_state", { ...args, state: "tampered" }, "credential-a"],
      ["set_test_state", args, "credential-b"],
    ] as const) {
      expect(() =>
        service.verify(state, toolName, changedArgs, credential),
      ).toThrow("Invalid or expired mutation confirmation");
    }
  });

  it("rejects tampered and expired state without revealing why", () => {
    let now = 1_000;
    const service = createMutationConfirmationService("test-key", () => now);
    const state = service.issue("set_test_state", args, "credential-a");
    const packed = Buffer.from(state.slice("mc_".length), "base64url");
    packed[0] ^= 1;
    const tamperedState = `mc_${packed.toString("base64url")}`;

    expect(() =>
      service.verify(
        tamperedState,
        "set_test_state",
        args,
        "credential-a",
      ),
    ).toThrow("Invalid or expired mutation confirmation");
    now += 5 * 60 * 1_000 + 1;
    expect(() =>
      service.verify(state, "set_test_state", args, "credential-a"),
    ).toThrow("Invalid or expired mutation confirmation");
  });
});

describe("mutation catalog registrar", () => {
  function setup() {
    const server = createMockServer();
    const requestCreate = vi.fn().mockResolvedValue({
      uid: "item-1",
      previousState: "before",
      state: "after",
      privateField: "must be stripped",
    });
    registerMutationCatalogTool(
      server as never,
      (() => ({ transport: { requestCreate } })) as never,
      definition,
      {
        confirmation: createMutationConfirmationService("registrar-key"),
        credentialBinding: "credential-a",
      },
    );
    return { server, requestCreate, handler: server.getHandler("set_test_state")! };
  }

  it("advertises the reviewed mutation security contract", () => {
    const { server } = setup();

    expect(server.getConfig("set_test_state")).toMatchObject({
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
      _meta: {
        "avala.ai/rest-route": "test-state",
        "avala.ai/rest-method": "POST",
        "avala.ai/required-scope": "test.write",
        "avala.ai/toolset": "staff",
        "avala.ai/requires-confirmation": true,
        "avala.ai/idempotency-header": "Idempotency-Key",
      },
    });
  });

  it("does not call REST until modern protocol approval is validated", async () => {
    const { handler, requestCreate } = setup();

    const pending = await handler(args, modernContext());

    expect(pending.resultType).toBe("input_required");
    expect(pending.requestState).toMatch(/^mc_/);
    expect(pending.inputRequests).toHaveProperty("confirmAvalaMutation");
    expect(requestCreate).not.toHaveBeenCalled();
    if (!pending.requestState) throw new Error("Missing confirmation state.");

    const completed = await handler(
      args,
      modernContext(acceptedResponse, pending.requestState),
    );

    expect(requestCreate).toHaveBeenCalledWith(
      "/test/item-1/state/",
      {
        expected_state: "before",
        state: "after",
        reason: "Scheduled transition",
      },
      {
        idempotencyKey: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      },
    );
    expect(completed.structuredContent).toEqual({
      uid: "item-1",
      previousState: "before",
      state: "after",
      reversalGuidance: "Set the state back to before.",
    });
    expect(JSON.parse(completed.content[0]!.text)).toEqual(
      completed.structuredContent,
    );
  });

  it("refuses declined, injected and tampered approvals without REST", async () => {
    const { handler, requestCreate } = setup();

    const declined = await handler(
      args,
      modernContext({
        confirmAvalaMutation: { action: "decline" },
      }),
    );
    expect(declined.isError).toBe(true);

    await expect(
      handler(args, modernContext(acceptedResponse)),
    ).rejects.toThrow("Invalid or expired mutation confirmation");
    const pending = await handler(args, modernContext());
    if (!pending.requestState) throw new Error("Missing confirmation state.");
    await expect(
      handler(
        { ...args, state: "tampered" },
        modernContext(acceptedResponse, pending.requestState),
      ),
    ).rejects.toThrow("Invalid or expired mutation confirmation");
    expect(requestCreate).not.toHaveBeenCalled();
  });

  it("uses protocol elicitation for legacy stdio clients", async () => {
    const { handler, requestCreate } = setup();

    await handler(args, legacyContext());

    expect(requestCreate).toHaveBeenCalledOnce();
    expect(requestCreate.mock.calls[0]![2].idempotencyKey).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });
});
