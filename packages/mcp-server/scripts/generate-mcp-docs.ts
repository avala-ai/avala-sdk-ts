/**
 * MCP Documentation Generator
 *
 * Registers the live MCP catalog against a metadata-capturing server and
 * generates a markdown tool reference. Used by CI to detect drift between
 * the MCP server implementation and the published documentation.
 *
 * Usage:
 *   npx tsx scripts/generate-mcp-docs.ts           # Print generated docs to stdout
 *   npx tsx scripts/generate-mcp-docs.ts --check    # Compare against committed docs (exit 1 on diff)
 *   npx tsx scripts/generate-mcp-docs.ts --list     # Print tool names only
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { TOOL_REGISTRARS } from "../src/server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Types ──────────────────────────────────────────────────────────────────

interface ToolParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

interface Tool {
  name: string;
  description: string;
  params: ToolParam[];
  isMutation: boolean;
  category: string;
}

// ── Category display names and order ───────────────────────────────────────

const CATEGORY_ORDER: Record<string, string> = {
  datasets: "Datasets",
  projects: "Projects",
  exports: "Exports",
  tasks: "Tasks",
  stats: "Workspace",
  agents: "Agents",
  organizations: "Organizations & Slices",
  slices: "Organizations & Slices",
  webhooks: "Webhooks",
  storage: "Storage",
  quality: "Quality & Consensus",
  consensus: "Quality & Consensus",
  annotationIssues: "Annotation Issues & QC",
  fleet: "Fleet",
  workflows: "Workflows",
};

// ── Parser ─────────────────────────────────────────────────────────────────

interface ZodLike {
  description?: string;
  isOptional?: () => boolean;
  _def?: {
    description?: string;
    innerType?: ZodLike;
    shape?: (() => Record<string, ZodLike>) | Record<string, ZodLike>;
    typeName?: string;
    values?: string[];
  };
}

interface RegisteredTool {
  category: string;
  description: string;
  inputSchema: unknown;
  name: string;
}

function inputShape(inputSchema: unknown): Record<string, ZodLike> {
  if (typeof inputSchema !== "object" || inputSchema === null) return {};
  const schema = inputSchema as ZodLike;
  const shape = schema._def?.shape;
  if (typeof shape === "function") return shape();
  if (typeof shape === "object" && shape !== null) return shape;
  return inputSchema as Record<string, ZodLike>;
}

function parameterType(schema: ZodLike): string {
  let current = schema;
  while (["ZodOptional", "ZodNullable", "ZodDefault"].includes(current._def?.typeName ?? "")) {
    if (!current._def?.innerType) break;
    current = current._def.innerType;
  }

  switch (current._def?.typeName) {
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodArray":
      return "array";
    case "ZodRecord":
    case "ZodObject":
      return "object";
    case "ZodEnum":
      return current._def.values?.length
        ? `string (${current._def.values.map((value) => `\`${value}\``).join(", ")})`
        : "string";
    default:
      return "string";
  }
}

function extractParams(inputSchema: unknown): ToolParam[] {
  return Object.entries(inputShape(inputSchema)).map(([name, schema]) => {
    const required = typeof schema.isOptional === "function" ? !schema.isOptional() : true;
    return {
      name,
      type: parameterType(schema),
      required,
      description: schema.description ?? schema._def?.description ?? "",
    };
  });
}

function collectRegisteredTools(allowMutations: boolean): Map<string, RegisteredTool> {
  const registrations = new Map<string, RegisteredTool>();

  for (const registrar of TOOL_REGISTRARS) {
    const capture = (name: string, description: string, inputSchema: unknown): void => {
      if (registrations.has(name)) throw new Error(`Duplicate MCP tool registration: ${name}`);
      registrations.set(name, { category: registrar.category, description, inputSchema, name });
    };
    const server = {
      tool: (name: string, description: string, inputSchema: unknown): void =>
        capture(name, description, inputSchema),
      registerTool: (
        name: string,
        config: { description?: string; inputSchema?: unknown },
      ): void => capture(name, config.description ?? "", config.inputSchema),
    };
    const getClient = (): never => {
      throw new Error("Tool registrars must not resolve an API client during registration.");
    };
    registrar.register(server as never, getClient as never, { allowMutations });
  }

  return registrations;
}

function registeredTools(): Tool[] {
  const readOnlyNames = new Set(collectRegisteredTools(false).keys());
  return [...collectRegisteredTools(true).values()].map((tool) => ({
    category: tool.category,
    description: tool.description,
    isMutation: !readOnlyNames.has(tool.name),
    name: tool.name,
    params: extractParams(tool.inputSchema),
  }));
}

// ── Generator ──────────────────────────────────────────────────────────────

function generateToolTable(tools: Tool[]): string {
  const lines: string[] = [];

  // Group tools by display category
  const grouped = new Map<string, Tool[]>();
  for (const tool of tools) {
    const displayCategory = CATEGORY_ORDER[tool.category] || tool.category;
    if (!grouped.has(displayCategory)) grouped.set(displayCategory, []);
    grouped.get(displayCategory)!.push(tool);
  }

  for (const [category, categoryTools] of grouped) {
    lines.push(`### ${category}`);
    lines.push("");
    lines.push("| Tool | Description |");
    lines.push("|---|---|");
    for (const tool of categoryTools) {
      const mutation = tool.isMutation
        ? " *(requires `AVALA_MCP_ENABLE_MUTATIONS=true`)*"
        : "";
      lines.push(`| \`${tool.name}\` | ${tool.description}${mutation} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function generateToolDefinitions(tools: Tool[]): string {
  const lines: string[] = [];

  for (const tool of tools) {
    const mutation = tool.isMutation
      ? " *(requires `AVALA_MCP_ENABLE_MUTATIONS=true`)*"
      : "";
    lines.push(`### ${tool.name}`);
    lines.push("");
    lines.push(`${tool.description}${mutation}`);
    lines.push("");

    if (tool.params.length === 0) {
      lines.push("**Parameters:** None");
    } else {
      lines.push("**Parameters:**");
      for (const param of tool.params) {
        const req = param.required ? "required" : "optional";
        lines.push(`- \`${param.name}\` (${param.type}, ${req}) — ${param.description}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const allTools = registeredTools();

  const mode = process.argv[2];

  if (mode === "--list") {
    for (const tool of allTools) {
      const flag = tool.isMutation ? " [mutation]" : "";
      console.log(`${tool.name}${flag} (${CATEGORY_ORDER[tool.category] || tool.category})`);
    }
    console.log(`\nTotal: ${allTools.length} tools`);
    return;
  }

  if (mode === "--check") {
    // Compare tool names against what's documented
    const docsPath = join(__dirname, "..", "..", "..", "..", "..", "docs", "integrations", "mcp-setup.mdx");
    let docsContent: string = "";
    try {
      docsContent = readFileSync(docsPath, "utf-8");
    } catch {
      console.error(`Cannot read docs file: ${docsPath}`);
      process.exit(1);
    }

    const availableToolsSection = docsContent.match(/## Available MCP Tools([\s\S]*?)## Tool Definitions/)?.[1];
    if (!availableToolsSection) {
      console.error("Cannot find the Available MCP Tools section in the MCP setup docs.");
      process.exit(1);
    }

    const documentedTools = new Set<string>();
    const toolNameRegex = /^\|\s*`([A-Za-z0-9_]+)`\s*\|/gm;
    let toolMatch;
    while ((toolMatch = toolNameRegex.exec(availableToolsSection)) !== null) {
      documentedTools.add(toolMatch[1]);
    }

    const implementedNames = new Set(allTools.map((t) => t.name));
    const undocumented = [...implementedNames].filter((n) => !documentedTools.has(n));
    const orphaned = [...documentedTools].filter((n) => !implementedNames.has(n));

    if (undocumented.length === 0 && orphaned.length === 0) {
      console.log(`All ${implementedNames.size} tools are documented. No drift detected.`);
      process.exit(0);
    }

    if (undocumented.length > 0) {
      console.error(`\nUndocumented tools (${undocumented.length}):`);
      for (const name of undocumented) console.error(`  - ${name}`);
    }
    if (orphaned.length > 0) {
      console.error(`\nOrphaned docs (tool removed but still documented) (${orphaned.length}):`);
      for (const name of orphaned) console.error(`  - ${name}`);
    }

    process.exit(1);
  }

  // Default: print generated docs
  console.log("## Available MCP Tools\n");
  console.log(generateToolTable(allTools));
  console.log("## Tool Definitions\n");
  console.log(generateToolDefinitions(allTools));
}

main();
