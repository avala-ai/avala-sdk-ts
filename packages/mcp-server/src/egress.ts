/**
 * The single egress boundary for every MCP tool result.
 *
 * ## Why this is a wrapper and not a helper
 *
 * Before this existed, redaction was something a tool handler *opted into*.
 * The measured result of that design, on 2026-08-28: of 64 registered tools,
 * 36 routed through the sanitizing catalog wrapper, exactly ONE hand-written
 * tool called `safeStringify`, and **24 serialized the upstream response with a
 * bare `JSON.stringify` and reached no redaction at all** — including
 * `get_frame`, which returns presigned S3 URLs and an export snippet carrying
 * annotator and reviewer identity.
 *
 * A helper cannot fix that, because the failure mode is forgetting to call the
 * helper. So this wraps the server itself: every `registerTool` handler is
 * decorated on its way in, and a tool added tomorrow by someone who has never
 * read this file is covered without doing anything. There is no opt-in and no
 * opt-out.
 *
 * ## Why key-name redaction was not enough
 *
 * `redact.ts` matches key NAMES (`apiKey`, `awsSecretAccessKey`). That is a
 * real control for config blobs and it is blind to the leak that actually
 * shipped, because the credential sits in the VALUE of an innocuous key:
 *
 *     { logo: "https://…/logo.png?AWSAccessKeyId=AKIA…&Signature=…&x-amz-security-token=…" }
 *
 * `AWSAccessKeyId` is in that deny-list — as a key name, which cannot reach a
 * URL query parameter. Verified against the shipped module: the object above
 * passed through byte-for-byte unchanged. So the two controls compose here and
 * neither replaces the other: key-name redaction first, then a value-level scan
 * (`secrets.ts`) over every remaining string.
 *
 * ## Why an MCP result is not an API response
 *
 * A REST response goes to one caller. A tool result goes into a model's context
 * window, and from there into the client transcript, the client's logs, the
 * provider's request logs, any trace or eval store, and — for a hosted client —
 * a third party's retention window. One call fans out to sinks the API boundary
 * never had, and none of them are ours to purge. See
 * `docs/avala-mcp-read-contract.md`.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { findSecrets, scrubValue, type Finding } from "./secrets.js";

/**
 * Reported when a tool tried to emit a credential.
 *
 * The scrub already happened by the time this fires — this exists so the event
 * is *visible*, because a scrubber quietly cleaning the same field on every
 * call is a defect nobody is looking at. `Finding.sample` is deliberately
 * non-reproducing (prefix, length, digest), so an observer can be wired to this
 * without the observer becoming a new place the secret lands.
 */
export type EgressObserver = (event: {
  readonly tool: string;
  readonly findings: readonly Finding[];
}) => void;

let observer: EgressObserver | undefined;

/** Register a sink for egress findings. Never receives raw secret material. */
export function setEgressObserver(next: EgressObserver | undefined): void {
  observer = next;
}

/**
 * Scrub one tool result.
 *
 * Exported for tests and for the rare caller that builds a result outside a
 * registered handler. Prefer the wrapper: a call site that can be forgotten
 * will be.
 */
export function scrubToolResult<T>(tool: string, result: T): T {
  const findings = findSecrets(result);
  if (findings.length > 0) {
    // Fire-and-forget and never throw: an observer must not be able to fail a
    // tool call, and must not become a reason to skip scrubbing.
    try {
      observer?.({ tool, findings });
    } catch {
      /* ignore */
    }
  }
  return scrubValue(result);
}

/**
 * Return a server whose every registered tool handler scrubs its result.
 *
 * Composes with `scopeServerForCredential` — both are Proxies over
 * `registerTool`, so order is not load-bearing, but this one is applied
 * innermost in `registerTools` so that a tool hidden from a credential is
 * still scrubbed if it is somehow reached.
 */
export function enforceEgressScrubbing(server: McpServer): McpServer {
  return new Proxy(server, {
    get(target, property) {
      if (property === "registerTool") {
        return (
          name: unknown,
          config: unknown,
          ...rest: unknown[]
        ): unknown => {
          if (typeof name !== "string")
            throw new Error("MCP tool name must be a string.");
          const wrapped = rest.map((argument) =>
            typeof argument === "function"
              ? wrapHandler(name, argument as (...a: unknown[]) => unknown)
              : argument,
          );
          return Reflect.apply(target.registerTool, target, [
            name,
            config,
            ...wrapped,
          ]);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function wrapHandler(
  tool: string,
  handler: (...args: unknown[]) => unknown,
): (...args: unknown[]) => unknown {
  return (...args: unknown[]): unknown => {
    const result = handler(...args);
    // A handler may be sync or async; `Promise.resolve` would change a sync
    // handler's contract, so branch rather than normalise.
    return result instanceof Promise
      ? result.then((resolved) => scrubToolResult(tool, resolved))
      : scrubToolResult(tool, result);
  };
}
