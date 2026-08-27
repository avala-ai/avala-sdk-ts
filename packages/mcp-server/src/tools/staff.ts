import { AvalaError, RateLimitError } from "@avala-ai/sdk";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GetClient } from "../client.js";
import type { McpServerOptions } from "../server.js";

/**
 * Staff-only proxies to the Django SQL sandbox at `POST /api/v1/mcp/`.
 *
 * These are the only tools that are not 1:1 REST calls (security.md, "MCP
 * Endpoint Security"): each forwards a JSON-RPC `tools/call` envelope to the
 * Django endpoint with the caller's own credential, and that endpoint's
 * permission list — `IsStaffAndNotApiKeyOrStaffApiKey` +
 * `HasScope(mcp.query)` — remains the authorization boundary. The sandbox is
 * SELECT-only inside a read-only transaction with an AST validator
 * (`server/apps/mcp/sql_validator.py`), so every tool here is read-only.
 *
 * Discovery: `/users/me/permissions` lists the `staff` toolset only for
 * staff-privileged credentials (a session, or an API key with
 * `is_staff_access`), so hosted visibility hides these tools from everyone
 * else. The `isStaffPrivileged` re-check in the handler is the plan's
 * defence-in-depth (mcp-platform-auth-model.md §5.4) — the hosted server
 * refuses to forward even if a registration bug ever lists the tool.
 */

const STAFF_TOOL_META = {
  "avala.ai/required-scopes": ["mcp.query"],
  "avala.ai/toolset": "staff",
} as const;

// The sandbox is cross-tenant but strictly read-only; `openWorldHint: false`
// because it talks to exactly one closed system (the Avala database).
const STAFF_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const JSON_SCALAR = z.union([z.string(), z.number(), z.boolean(), z.null()]);

interface SandboxContent {
  type: "text";
  text: string;
}

// Index signature matches the MCP SDK's CallToolResult shape.
interface SandboxToolResult {
  [key: string]: unknown;
  content: SandboxContent[];
  isError?: boolean;
}

function sandboxError(message: string): SandboxToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Django answers a throttled or malformed sandbox call with a non-2xx body
 * shaped like a JSON-RPC error (`{"error": {"message": ...}}`), not the
 * `{"detail": ...}` the SDK's error handler knows how to unwrap — so the
 * SDK message alone is a bare "HTTP 429". Recover the sandbox's own message
 * (e.g. "Query rate limit exceeded. Please wait 12.3 seconds.") and the
 * Retry-After hint so the agent can act on them.
 */
function transportFailureMessage(error: unknown): string {
  if (!(error instanceof AvalaError)) {
    return error instanceof Error ? error.message : "request failed";
  }
  const body = error.body as { error?: { message?: unknown } } | null;
  const sandboxMessage =
    typeof body === "object" && body !== null
      ? body.error?.message
      : undefined;
  let message =
    typeof sandboxMessage === "string" && sandboxMessage.trim() !== ""
      ? `${error.message}: ${sandboxMessage}`
      : error.message;
  if (error instanceof RateLimitError && error.retryAfter !== null) {
    message += ` (retry after ${error.retryAfter}s)`;
  }
  return message;
}

/**
 * Forward one `tools/call` to the Django sandbox and translate its JSON-RPC
 * envelope back into an MCP tool result. Fail closed: any response that is
 * not the documented envelope becomes an `isError` result, never a
 * pass-through of unrecognized data.
 */
async function callSandbox(
  getClient: GetClient,
  options: McpServerOptions,
  proxyToolName: string,
  sandboxToolName: string,
  args: Record<string, unknown>,
): Promise<SandboxToolResult> {
  // Defence in depth, not the boundary (plan §5.4): the hosted transport
  // always supplies the discovered grant, and a credential whose permission
  // discovery did not report staff privilege must not have staff calls
  // forwarded on its behalf — even if the tool was somehow listed. The local
  // stdio server has no grant; there Django alone decides.
  if (options.credentialGrant && !options.credentialGrant.isStaffPrivileged) {
    return sandboxError(
      "Error: this credential is not staff-privileged; the staff sandbox is unavailable.",
    );
  }

  const avala = getClient(proxyToolName);
  let response: unknown;
  try {
    response = await avala.transport.request("POST", "/mcp/", {
      json: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: sandboxToolName, arguments: args },
      },
    });
  } catch (error) {
    return sandboxError(
      `Error: staff sandbox call failed: ${transportFailureMessage(error)}`,
    );
  }

  if (typeof response !== "object" || response === null) {
    return sandboxError("Error: staff sandbox returned an invalid response.");
  }
  const envelope = response as { result?: unknown; error?: unknown };
  // A JSON-RPC error member is an object; `error: null` beside a result is
  // the other common serialization of success and must not read as a
  // rejection.
  if (typeof envelope.error === "object" && envelope.error !== null) {
    const rpcMessage = (envelope.error as { message?: unknown }).message;
    const message =
      typeof rpcMessage === "string" ? rpcMessage : "unknown sandbox error";
    return sandboxError(`Error: staff sandbox rejected the call: ${message}`);
  }
  if (envelope.error !== undefined && envelope.error !== null) {
    return sandboxError("Error: staff sandbox returned an invalid response.");
  }
  const result = envelope.result as
    | { content?: unknown; isError?: unknown }
    | undefined;
  const rawContent = result?.content;
  const content = Array.isArray(rawContent) ? rawContent : null;
  if (
    content === null ||
    !content.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        (item as { type?: unknown }).type === "text" &&
        typeof (item as { text?: unknown }).text === "string",
    )
  ) {
    return sandboxError("Error: staff sandbox returned an invalid response.");
  }
  return {
    content: content as SandboxContent[],
    ...(result?.isError === true ? { isError: true } : {}),
  };
}

export function registerStaffTools(
  server: McpServer,
  getClient: GetClient,
  options: McpServerOptions,
): void {
  server.registerTool(
    "staff_query",
    {
      description:
        "Staff only: run a read-only SQL SELECT in the Avala staff sandbox (cross-tenant; validated against an allow-list of tables and columns). Use %s placeholders with params for values.",
      inputSchema: {
        sql: z.string().describe("A single SELECT statement."),
        params: z
          .array(JSON_SCALAR)
          .optional()
          .describe("Positional values for %s placeholders."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe("Max rows (default 100, max 1000)."),
      },
      annotations: { title: "Staff SQL query", ...STAFF_TOOL_ANNOTATIONS },
      _meta: STAFF_TOOL_META,
    },
    async (args: Record<string, unknown>) =>
      callSandbox(getClient, options, "staff_query", "query", args),
  );

  server.registerTool(
    "staff_aggregate",
    {
      description:
        "Staff only: aggregate (count/sum/avg/min/max) over a table in the Avala staff sandbox, optionally grouped and filtered.",
      inputSchema: {
        table_name: z.string().describe("The table to aggregate over."),
        aggregation: z
          .enum(["count", "sum", "avg", "min", "max"])
          .describe("The aggregation to compute."),
        column: z
          .string()
          .optional()
          .describe("Column for sum/avg/min/max (ignored for count)."),
        group_by: z.string().optional().describe("Column to group by."),
        filters: z
          .array(
            z.object({
              column: z.string().describe("Column to filter on."),
              operator: z
                .string()
                .describe(
                  "Comparison operator, e.g. =, !=, >, <, LIKE, IN, IS NULL, IS NOT NULL.",
                ),
              // The sandbox's own schema requires only column + operator; IS
              // NULL / IS NOT NULL take no value.
              value: JSON_SCALAR.optional().describe(
                "Comparison value; omit for IS NULL / IS NOT NULL.",
              ),
            }),
          )
          .optional()
          .describe("Row filters, ANDed together."),
      },
      annotations: { title: "Staff aggregate", ...STAFF_TOOL_ANNOTATIONS },
      _meta: STAFF_TOOL_META,
    },
    async (args: Record<string, unknown>) =>
      callSandbox(getClient, options, "staff_aggregate", "aggregate", args),
  );

  server.registerTool(
    "staff_describe_table",
    {
      description:
        "Staff only: describe an allow-listed table's columns, types, and indexes in the Avala staff sandbox.",
      inputSchema: {
        table_name: z.string().describe("The table to describe."),
      },
      annotations: {
        title: "Staff describe table",
        ...STAFF_TOOL_ANNOTATIONS,
      },
      _meta: STAFF_TOOL_META,
    },
    async (args: Record<string, unknown>) =>
      callSandbox(
        getClient,
        options,
        "staff_describe_table",
        "describe_table",
        args,
      ),
  );
}
