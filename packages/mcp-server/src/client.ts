import type { Avala } from "@avala-ai/sdk";

/**
 * Returns the Avala client for the named tool invocation.
 *
 * Tools never hold a client themselves — they call this at the start of every
 * invocation and must provide their exact registered MCP tool name. In stdio
 * mode clients are process-wide and keyed by that name. In HTTP mode every
 * request gets a fresh MCP server and a per-name client cache closed over that
 * request's credential, so a credential can never leak between concurrent
 * requests and every REST call carries precise audit metadata.
 *
 * The client the function returns performs plain REST calls with the caller's
 * credential; the MCP process performs no authorization of its own — the
 * Django API is the only authorization layer
 * (security/docs/plans/mcp-platform-auth-model.md §4.1).
 */
export type GetClient = (clientName: string) => Avala;
