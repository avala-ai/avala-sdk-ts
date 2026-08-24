import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Avala } from "@avala-ai/sdk";
import { registerTools } from "./server.js";
import { parseBooleanEnvValue } from "./env.js";

const apiKey = process.env.AVALA_API_KEY;
if (!apiKey) {
  console.error("Error: AVALA_API_KEY environment variable is required.");
  process.exit(1);
}

const allowMutations = parseBooleanEnvValue(process.env.AVALA_MCP_ENABLE_MUTATIONS);
if (!allowMutations) {
  console.warn("Avala MCP running in read-only mode. Set AVALA_MCP_ENABLE_MUTATIONS=true to enable write/delete tools.");
}

// stdio mode: one long-lived client for the whole process, built from the
// environment credential. Tools still fetch it per call through `getClient`.
const avala = new Avala({ apiKey });

const server = new McpServer({
  name: "avala",
  version: "0.6.0",
});

registerTools(server, () => avala, { allowMutations });

const transport = new StdioServerTransport();
await server.connect(transport);
