import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Avala } from "@avala-ai/sdk";
import { registerTools } from "./server.js";

const apiKey = process.env.AVALA_API_KEY;
if (!apiKey) {
  console.error("Error: AVALA_API_KEY environment variable is required.");
  process.exit(1);
}

const avala = new Avala({ apiKey });

const server = new McpServer({
  name: "avala",
  version: "0.2.0",
});

registerTools(server, avala);

const transport = new StdioServerTransport();
await server.connect(transport);
