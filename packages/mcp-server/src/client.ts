import type { Avala } from "@avala-ai/sdk";

/**
 * Returns the Avala client for the current tool invocation.
 *
 * Tools never hold a client themselves — they call this at the start of every
 * invocation. In stdio mode `getClient` returns a process-wide singleton built
 * from `AVALA_API_KEY`. In HTTP mode every request gets a fresh MCP server and
 * a `getClient` closed over that request's credential, so a credential can
 * never leak between concurrent requests.
 *
 * The client the function returns performs plain REST calls with the caller's
 * credential; the MCP process performs no authorization of its own — the
 * Django API is the only authorization layer
 * (security/docs/plans/mcp-platform-auth-model.md §4.1).
 */
export type GetClient = () => Avala;
