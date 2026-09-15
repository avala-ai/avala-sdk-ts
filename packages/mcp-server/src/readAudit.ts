import type { McpServer } from "@modelcontextprotocol/server";

/** Invocation telemetry, not an attributed access ledger or execution receipt. */
export interface HostedInvocationEvent {
  event: "mcp.tool_invocation";
  /** UTC wall-clock time at handler completion, independent of the log sink. */
  observedAt: string;
  credentialKind: "api_key" | "oauth";
  tool: string;
  operationKind: "read" | "mutation";
  latencyMs: number;
  /** Handler completion only; not SDK response validation or durable execution. */
  outcome: "success" | "error" | "degraded" | "input_required" | "unknown";
  attribution: "unknown";
  verifiedActorUid: null;
  resolvedTenant: null;
  resultShape: {
    contentBlocks: number;
    textCharacters: number;
    hasStructuredContent: boolean;
    items: number | null;
    /** Metadata inspection/counts were capped; not a claim about payload completeness. */
    truncated: boolean;
  } | null;
}

export type InvocationObserver = (
  event: HostedInvocationEvent,
) => void | Promise<void>;

export interface HostedInvocationOptions {
  credentialKind: HostedInvocationEvent["credentialKind"];
  observer?: InvocationObserver;
}

const MAX_COUNT = 1000;
const MAX_TEXT_CHARACTERS = 1_000_000;
const MAX_JSON_CHARACTERS = 65_536;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function summarize(
  result: unknown,
): Pick<HostedInvocationEvent, "outcome" | "resultShape"> {
  const value = record(result);
  if (!value) return { outcome: "unknown", resultShape: null };
  const content = Array.isArray(value.content) ? value.content : [];
  const structured = record(value.structuredContent);
  const items = Array.isArray(structured?.items)
    ? structured.items.length
    : null;
  let truncated =
    content.length > MAX_COUNT || (items !== null && items > MAX_COUNT);
  let textCharacters = 0;
  for (let index = 0; index < Math.min(content.length, MAX_COUNT); index++) {
    const block = record(content[index]);
    if (block?.type === "text" && typeof block.text === "string") {
      textCharacters += block.text.length;
      if (textCharacters > MAX_TEXT_CHARACTERS) {
        textCharacters = MAX_TEXT_CHARACTERS;
        truncated = true;
        break;
      }
    }
  }

  let outcome: HostedInvocationEvent["outcome"] = "unknown";
  if (value.isError === true) outcome = "error";
  else if (record(value.inputRequests)) outcome = "input_required";
  else if (structured?.degraded === true) outcome = "degraded";
  else if (structured) outcome = "success";
  else if (Array.isArray(value.content)) {
    outcome = "success";
    // Older handwritten composites encode their degraded flag only in text.
    // Parse one bounded JSON block; never emit keys, values or parse errors.
    const block = content.length === 1 ? record(content[0]) : undefined;
    if (block?.type === "text" && typeof block.text === "string") {
      if (block.text.length > MAX_JSON_CHARACTERS) {
        outcome = "unknown";
        truncated = true;
      } else {
        try {
          if (record(JSON.parse(block.text))?.degraded === true)
            outcome = "degraded";
        } catch {
          // Legacy plain text (even an error message without isError) means
          // handler completion, not semantic success. Never inspect its words.
        }
      }
    }
  }
  return {
    outcome,
    resultShape: {
      contentBlocks: Math.min(content.length, MAX_COUNT),
      textCharacters,
      hasStructuredContent: structured !== undefined,
      items: items === null ? null : Math.min(items, MAX_COUNT),
      truncated,
    },
  };
}

/**
 * Install beneath the egress registration facade: the stored handler must be
 * observe(scrub(handler)), so observers summarize only sanitized results.
 *
 * Observe ALL hosted invocations, including the reviewed mutations. The hosted
 * server admits writes only from mutationTools; neither scopes nor optional
 * readOnlyHint annotations identify all reads. Names come from registration,
 * never request headers. Pre-handler auth/protocol/schema rejects are outside
 * this boundary. No credential, argument, error object or attribution is read.
 */
export function observeHostedInvocations(
  server: McpServer,
  options: HostedInvocationOptions,
  mutationTools: ReadonlySet<string>,
): McpServer {
  const {
    credentialKind,
    observer = (event): void => console.info(JSON.stringify(event)),
  } = options;

  function wrap(
    tool: string,
    handler: (...args: unknown[]) => unknown,
  ): (...args: unknown[]) => unknown {
    const operationKind = mutationTools.has(tool) ? "mutation" : "read";
    return (...args: unknown[]): unknown => {
      const started = performance.now();
      const emit = (result: unknown, failed: boolean): void => {
        try {
          const elapsed = performance.now() - started;
          const event: HostedInvocationEvent = {
            event: "mcp.tool_invocation",
            observedAt: new Date().toISOString(),
            credentialKind,
            tool,
            operationKind,
            latencyMs: Number.isFinite(elapsed)
              ? Math.floor(Math.max(0, Math.min(elapsed, 2_147_483_647)))
              : 0,
            attribution: "unknown",
            verifiedActorUid: null,
            resolvedTenant: null,
            ...(failed
              ? { outcome: "error" as const, resultShape: null }
              : summarize(result)),
          };
          // Neither a synchronous throw nor an asynchronous rejection may
          // change the response. Do not wait for an injected observer or log
          // its failure (which could contain arbitrary sensitive text).
          void Promise.resolve(observer(event)).catch(() => {});
        } catch {
          // Best effort only, including malformed provider objects/getters.
        }
      };
      try {
        const result = handler(...args);
        if (result instanceof Promise) {
          return result.then(
            (resolved) => {
              emit(resolved, false);
              return resolved;
            },
            (error: unknown) => {
              emit(undefined, true);
              throw error;
            },
          );
        }
        emit(result, false);
        return result;
      } catch (error) {
        emit(undefined, true);
        throw error;
      }
    };
  }

  return new Proxy(server, {
    get(target, property) {
      if (property === "registerTool") {
        return (
          name: unknown,
          config: unknown,
          ...rest: unknown[]
        ): unknown => {
          if (
            typeof name !== "string" ||
            !/^[a-z][a-z0-9_]{0,63}$/.test(name)
          ) {
            throw new Error(
              "Hosted invocation telemetry requires a canonical registered tool name.",
            );
          }
          return Reflect.apply(target.registerTool, target, [
            name,
            config,
            ...rest.map((argument) =>
              typeof argument === "function"
                ? wrap(name, argument as (...args: unknown[]) => unknown)
                : argument,
            ),
          ]);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
