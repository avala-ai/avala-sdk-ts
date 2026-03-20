/**
 * MCP Documentation Generator
 *
 * Extracts tool metadata from the MCP server source files and generates
 * a markdown tool reference. Used by CI to detect drift between the
 * MCP server implementation and the published documentation.
 *
 * Usage:
 *   npx tsx scripts/generate-mcp-docs.ts           # Print generated docs to stdout
 *   npx tsx scripts/generate-mcp-docs.ts --check    # Compare against committed docs (exit 1 on diff)
 *   npx tsx scripts/generate-mcp-docs.ts --list     # Print tool names only
 */

import { readFileSync, readdirSync } from "fs";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";

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
};

// ── Parser ─────────────────────────────────────────────────────────────────

function parseToolFile(filePath: string): Tool[] {
  const content = readFileSync(filePath, "utf-8");
  const categoryName = basename(filePath, ".ts");
  const tools: Tool[] = [];

  // Track whether we're inside an `if (allowMutations)` block
  let inMutationBlock = false;
  let braceDepth = 0;
  let mutationBraceStart = 0;

  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect mutation block start
    if (line.includes("if (allowMutations)") || line.includes("if(allowMutations)")) {
      inMutationBlock = true;
      mutationBraceStart = 0;
      // Count braces from this point to find the block end
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === "{") mutationBraceStart++;
          if (ch === "}") {
            mutationBraceStart--;
            if (mutationBraceStart === 0) {
              // Mark the end line
              braceDepth = j;
              break;
            }
          }
        }
        if (mutationBraceStart === 0 && j > i) break;
      }
    }

    // Detect server.tool( call
    if (line.includes("server.tool(")) {
      const isMutation = inMutationBlock && i <= braceDepth;

      // Extract tool name (next line or same line with string)
      const toolLines = lines.slice(i, Math.min(i + 80, lines.length)).join("\n");

      // Extract name - first string argument
      const nameMatch = toolLines.match(/server\.tool\(\s*"([^"]+)"/);
      if (!nameMatch) continue;
      const toolName = nameMatch[1];

      // Extract description - second string argument
      const descMatch = toolLines.match(/server\.tool\(\s*"[^"]+",\s*"([^"]+)"/);
      const toolDesc = descMatch ? descMatch[1] : "";

      // Extract parameters from the Zod schema object
      const params = extractParams(toolLines);

      tools.push({
        name: toolName,
        description: toolDesc,
        params,
        isMutation,
        category: categoryName,
      });
    }
  }

  return tools;
}

function extractParams(toolBlock: string): ToolParam[] {
  const params: ToolParam[] = [];

  // Find the schema object (third argument - the { ... } block after the description)
  // Pattern: after the description string, find the next { ... } block
  const schemaStart = toolBlock.indexOf("{", toolBlock.indexOf('",'));
  if (schemaStart === -1) return params;

  // Find matching closing brace
  let depth = 0;
  let schemaEnd = schemaStart;
  for (let i = schemaStart; i < toolBlock.length; i++) {
    if (toolBlock[i] === "{") depth++;
    if (toolBlock[i] === "}") {
      depth--;
      if (depth === 0) {
        schemaEnd = i;
        break;
      }
    }
  }

  const schemaBlock = toolBlock.slice(schemaStart + 1, schemaEnd);

  // Extract each parameter line: name: z.type().optional().describe("...")
  const paramRegex = /(\w+):\s*z\.([\w()., ]+?)\.describe\("([^"]+)"\)/g;
  let match;

  while ((match = paramRegex.exec(schemaBlock)) !== null) {
    const [, name, zodChain, description] = match;
    const isOptional = zodChain.includes(".optional()");

    // Determine type from zod chain
    let type = "string";
    if (zodChain.startsWith("number")) type = "number";
    else if (zodChain.startsWith("boolean")) type = "boolean";
    else if (zodChain.startsWith("array")) type = "string[]";
    else if (zodChain.startsWith("record")) type = "object";
    else if (zodChain.startsWith("enum")) {
      const enumMatch = zodChain.match(/enum\(\[([^\]]+)\]/);
      if (enumMatch) {
        type = `string (${enumMatch[1].replace(/"/g, "`").replace(/,\s*/g, ", ")})`;
      }
    }

    params.push({
      name,
      type,
      required: !isOptional,
      description,
    });
  }

  return params;
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
  const toolsDir = join(__dirname, "..", "src", "tools");
  const files = readdirSync(toolsDir)
    .filter((f) => f.endsWith(".ts") && !f.includes(".test."))
    .sort();

  const allTools: Tool[] = [];
  for (const file of files) {
    const tools = parseToolFile(join(toolsDir, file));
    allTools.push(...tools);
  }

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

    const documentedTools = new Set<string>();
    const toolNameRegex = /`(\w+)`\s*\|/g;
    let toolMatch;
    while ((toolMatch = toolNameRegex.exec(docsContent)) !== null) {
      const name = toolMatch[1];
      // Filter to actual tool names (not parameter names)
      if (allTools.some((t) => t.name === name)) {
        documentedTools.add(name);
      }
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
