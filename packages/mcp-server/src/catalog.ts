import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GetClient } from "./client.js";

export type ReadToolset =
  | "datasets"
  | "sequences"
  | "slices"
  | "tasks"
  | "organizations"
  | "agents"
  | "webhooks"
  | "storage"
  | "quality"
  | "consensus"
  | "fleet";

export interface ReadRouteDefinition<InputSchema extends z.AnyZodObject> {
  /** Stable Django URL name from server/api_route_manifest.json. */
  name: string;
  method: "GET";
  /** Relative SDK path. Braced placeholders are filled from tool arguments. */
  path: string;
  /** Tool input key -> REST query-string key. */
  query?: Partial<Record<Extract<keyof z.infer<InputSchema>, string>, string>>;
  response: "page" | "single";
  scope: string;
  toolset: ReadToolset;
}

export interface ReadCatalogToolDefinition<
  InputSchema extends z.AnyZodObject,
  OutputSchema extends z.AnyZodObject,
> {
  name: string;
  title: string;
  description: string;
  inputSchema: InputSchema;
  outputSchema: OutputSchema;
  route: ReadRouteDefinition<InputSchema>;
}

export function defineReadCatalogTool<
  InputSchema extends z.AnyZodObject,
  OutputSchema extends z.AnyZodObject,
>(
  definition: ReadCatalogToolDefinition<InputSchema, OutputSchema>,
): ReadCatalogToolDefinition<InputSchema, OutputSchema> {
  return definition;
}

export function definePageOutputSchema<ItemSchema extends z.AnyZodObject>(
  itemSchema: ItemSchema,
): z.ZodObject<
  {
    items: z.ZodArray<ItemSchema>;
    nextCursor: z.ZodNullable<z.ZodString>;
    previousCursor: z.ZodNullable<z.ZodString>;
    hasMore: z.ZodBoolean;
  },
  "passthrough"
> {
  return z
    .object({
      items: z.array(itemSchema),
      nextCursor: z.string().nullable(),
      previousCursor: z.string().nullable(),
      hasMore: z.boolean(),
    })
    .passthrough();
}

function encodePathSegment(value: unknown, key: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`Path argument '${key}' must be a string or number.`);
  }

  const text = String(value);
  if (text === "" || text === "." || text === ".." || /[/\\\r\n\0]/.test(text)) {
    throw new Error(`Path argument '${key}' is not a valid URL path segment.`);
  }
  return encodeURIComponent(text);
}

export function renderCatalogPath(template: string, args: Record<string, unknown>): string {
  if (
    !template.startsWith("/") ||
    !template.endsWith("/") ||
    template.startsWith("//") ||
    template.slice(1).includes("//") ||
    template.includes("..") ||
    /[?#\r\n\0]/.test(template)
  ) {
    throw new Error(`Catalog path template must be an absolute, trailing-slash API path: ${template}`);
  }

  const rendered = template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_placeholder, key: string) =>
    encodePathSegment(args[key], key),
  );
  if (rendered.includes("{") || rendered.includes("}")) {
    throw new Error(`Catalog path template contains an invalid placeholder: ${template}`);
  }
  return rendered;
}

export function buildCatalogQuery<InputSchema extends z.AnyZodObject>(
  mapping: ReadRouteDefinition<InputSchema>["query"],
  args: Record<string, unknown>,
): Record<string, string> | undefined {
  if (!mapping) return undefined;

  const query: Record<string, string> = {};
  for (const [inputKey, queryKey] of Object.entries(mapping)) {
    if (queryKey === undefined) continue;
    const value = args[inputKey];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new Error(`Query argument '${inputKey}' must be a string, number, or boolean.`);
    }
    query[queryKey] = String(value);
  }
  return Object.keys(query).length > 0 ? query : undefined;
}

/**
 * Register one declarative read tool.
 *
 * The route definition is executable configuration: it builds the path and
 * query and selects the SDK transport method. Tool metadata and the actual
 * HTTP call therefore cannot drift into separate hand-written code paths.
 */
export function registerReadCatalogTool<
  InputSchema extends z.AnyZodObject,
  OutputSchema extends z.AnyZodObject,
>(
  server: McpServer,
  getClient: GetClient,
  definition: ReadCatalogToolDefinition<InputSchema, OutputSchema>,
): void {
  const handler = async (args: z.infer<InputSchema>): Promise<CallToolResult> => {
    const path = renderCatalogPath(definition.route.path, args);
    const query = buildCatalogQuery(definition.route.query, args);
    const transport = getClient().transport;
    const raw =
      definition.route.response === "page"
        ? await transport.requestPage<Record<string, unknown>>(path, query)
        : await transport.requestSingle<Record<string, unknown>>(path);
    const structuredContent = definition.outputSchema.parse(raw);
    return {
      structuredContent: structuredContent as Record<string, unknown>,
      content: [{ type: "text" as const, text: JSON.stringify(structuredContent, null, 2) ?? "{}" }],
    };
  };

  server.registerTool<OutputSchema, InputSchema>(
    definition.name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema,
      outputSchema: definition.outputSchema,
      annotations: {
        title: definition.title,
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: {
        "avala.ai/rest-route": definition.route.name,
        "avala.ai/rest-method": definition.route.method,
        "avala.ai/required-scope": definition.route.scope,
        "avala.ai/toolset": definition.route.toolset,
      },
    },
    // The MCP SDK's Zod v3/v4 compatibility type is a conditional over a
    // generic schema and cannot prove this callback's equivalent z.infer type.
    // The exact same schema object is passed above and validates every call at
    // runtime; keep the compatibility cast at this one SDK boundary.
    handler as unknown as ToolCallback<InputSchema>,
  );
}
