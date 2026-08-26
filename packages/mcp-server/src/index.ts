import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { Avala } from "@avala-ai/sdk";
import { createAvalaMcpServer } from "./server.js";
import { parseBooleanEnvValue } from "./env.js";

const apiKey = process.env.AVALA_API_KEY;
if (!apiKey) {
  console.error("Error: AVALA_API_KEY environment variable is required.");
  process.exit(1);
}

const allowMutations = parseBooleanEnvValue(
  process.env.AVALA_MCP_ENABLE_MUTATIONS,
);
if (!allowMutations) {
  console.warn(
    "Avala MCP running in read-only mode. Set AVALA_MCP_ENABLE_MUTATIONS=true to enable write/delete tools.",
  );
}

// stdio mode: long-lived clients keyed by exact MCP tool name, all built from
// the environment credential. This preserves the same per-tool REST metadata
// as hosted mode without sharing mutable request state.
const clients = new Map<string, Avala>();
const getClient = (clientName: string): Avala => {
  const existing = clients.get(clientName);
  if (existing) return existing;
  const client = new Avala({ apiKey, clientName });
  clients.set(clientName, client);
  return client;
};

serveStdio(() => createAvalaMcpServer(getClient, { allowMutations }), {
  legacy: "serve",
  onerror: () => console.error("avala-mcp-stdio: protocol request failed."),
});
