import type {
  McpServer,
  ToolCallback,
  CallToolResult,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GetClient } from "./client.js";
import type { AssetHandleService } from "./assetHandles.js";
import { sanitizeForOutput } from "./redact.js";
import {
  DEFAULT_PAGE_LIMIT,
  detailInputField,
  presentReadDetail,
  resolveReadDetail,
} from "./readDetail.js";

type AnyZodObject = z.ZodObject;

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
  | "fleet"
  | "exports"
  | "staff";

export interface ReadRouteDefinition<InputSchema extends AnyZodObject> {
  /** Stable Django URL name from server/api_route_manifest.json. */
  name: string;
  method: "GET";
  /** Relative SDK path. Braced placeholders are filled from tool arguments. */
  path: string;
  /** Tool input key -> REST query-string key. */
  query?: Partial<Record<Extract<keyof z.infer<InputSchema>, string>, string>>;
  /** Safe route-specific limit when it differs from the catalog default. */
  defaultLimit?: number;
  /** Constant query values required by this route in every invocation. */
  fixedQuery?: Readonly<Record<string, string>>;
  response: "page" | "list" | "single";
  scope: string;
  toolset: ReadToolset;
}

export interface ReadCatalogToolDefinition<
  InputSchema extends AnyZodObject,
  OutputSchema extends AnyZodObject,
> {
  name: string;
  title: string;
  description: string;
  inputSchema: InputSchema;
  outputSchema: OutputSchema;
  route: ReadRouteDefinition<InputSchema>;
  /**
   * Optional rewrite of the validated REST payload before detail projection.
   * Used for count-field aliases. Must not be a Zod transform — SDK v2 needs
   * transform-free output schemas.
   */
  normalize?: (value: unknown) => unknown;
  /**
   * Replace upstream media URLs with credential-free asset handles before the
   * public output schema validates the result. The callback receives validated
   * request arguments so every handle can name a resource that the resolver
   * will re-fetch under the caller's current credential.
   */
  assetize?: (
    value: unknown,
    args: Readonly<Record<string, unknown>>,
    handles: AssetHandleService,
  ) => unknown;
  /**
   * Whether callers may choose concise/full MCP projection. Defaults to true.
   * Set false for fixed-shape provider contracts so discovery does not
   * advertise a `detail` argument that cannot change the response.
   */
  supportsDetail?: boolean;
  /**
   * Keys kept when `detail` is omitted or `concise`.
   * TODO(payload-lane): fleet.ts and workflows.ts receive `detail` via
   * withReadDetailInput but do not set conciseKeys (other lane owns those
   * files). Until they opt in, their default responses stay full.
   */
  conciseKeys?: readonly string[];
  /** Override concise/full presentation after normalize. */
  project?: (
    value: unknown,
    detail: "concise" | "full",
    args: Readonly<Record<string, unknown>>,
  ) => unknown;
}

export type CompositeRouteReader = (routeName: string) => Promise<unknown>;

export interface CompositeReadCatalogToolDefinition<
  InputSchema extends AnyZodObject,
  OutputSchema extends AnyZodObject,
> {
  name: string;
  title: string;
  description: string;
  inputSchema: InputSchema;
  outputSchema: OutputSchema;
  routes: readonly [
    ReadRouteDefinition<InputSchema>,
    ...ReadRouteDefinition<InputSchema>[],
  ];
  execute: (
    args: z.infer<InputSchema>,
    read: CompositeRouteReader,
  ) => Promise<unknown>;
  normalize?: (value: unknown) => unknown;
  assetize?: (
    value: unknown,
    args: Readonly<Record<string, unknown>>,
    handles: AssetHandleService,
  ) => unknown;
  /** See ReadCatalogToolDefinition.supportsDetail. */
  supportsDetail?: boolean;
  conciseKeys?: readonly string[];
  project?: (
    value: unknown,
    detail: "concise" | "full",
    args: Readonly<Record<string, unknown>>,
  ) => unknown;
}

export function defineReadCatalogTool<
  InputSchema extends AnyZodObject,
  OutputSchema extends AnyZodObject,
>(
  definition: ReadCatalogToolDefinition<InputSchema, OutputSchema>,
): ReadCatalogToolDefinition<InputSchema, OutputSchema> {
  return definition;
}

export function defineCompositeReadCatalogTool<
  InputSchema extends AnyZodObject,
  OutputSchema extends AnyZodObject,
>(
  definition: CompositeReadCatalogToolDefinition<InputSchema, OutputSchema>,
): CompositeReadCatalogToolDefinition<InputSchema, OutputSchema> {
  return definition;
}

export function definePageOutputSchema<ItemSchema extends AnyZodObject>(
  itemSchema: ItemSchema,
) {
  return z
    .object({
      items: z.array(itemSchema),
      nextCursor: z.string().nullable(),
      previousCursor: z.string().nullable(),
      hasMore: z.boolean(),
      next_cursor: z.string().nullable().optional(),
      has_more: z.boolean().optional(),
      totalCount: z.number().int().nonnegative().nullable().optional(),
      total_count: z.number().int().nonnegative().nullable().optional(),
    })
    .passthrough();
}

/**
 * MCP structured content must be an object, even when the REST endpoint
 * returns a bare JSON array. Wrap list responses in a stable `items` object
 * for structured consumers while the text result keeps its legacy array
 * shape.
 */
export function defineListOutputSchema<ItemSchema extends AnyZodObject>(
  itemSchema: ItemSchema,
) {
  return z.object({ items: z.array(itemSchema) }).strip();
}

/**
 * Add `detail` to a catalog input schema when the tool did not declare it.
 * `detail` is MCP-layer projection — it is never mapped onto a REST query.
 */
export function withReadDetailInput<InputSchema extends AnyZodObject>(
  inputSchema: InputSchema,
  supportsDetail = true,
): InputSchema {
  if (!supportsDetail) return inputSchema;
  const shape = inputSchema.shape as Record<string, unknown>;
  if (shape.detail) return inputSchema;
  return inputSchema.extend({
    detail: detailInputField,
  }) as unknown as InputSchema;
}

/**
 * Default `limit` only when the route already maps it. Tools whose upstream
 * cannot paginate must not grow a fake client-side cursor.
 */
export function applyReadListDefaults(
  args: Record<string, unknown>,
  route: {
    query?: Partial<Record<string, string>>;
    defaultLimit?: number;
  },
): Record<string, unknown> {
  if (!route.query?.limit || args.limit !== undefined) return args;
  return { ...args, limit: route.defaultLimit ?? DEFAULT_PAGE_LIMIT };
}

function presentCatalogResult(
  value: unknown,
  args: Record<string, unknown>,
  definition: {
    normalize?: (value: unknown) => unknown;
    conciseKeys?: readonly string[];
    project?: (
      value: unknown,
      detail: "concise" | "full",
      args: Readonly<Record<string, unknown>>,
    ) => unknown;
  },
): unknown {
  const normalized = definition.normalize ? definition.normalize(value) : value;
  const detail = resolveReadDetail(args);
  if (definition.project) {
    return definition.project(normalized, detail, args);
  }
  return presentReadDetail(normalized, args, definition.conciseKeys);
}

function assetizeCatalogResult(
  value: unknown,
  args: Record<string, unknown>,
  definition: {
    assetize?: (
      value: unknown,
      args: Readonly<Record<string, unknown>>,
      handles: AssetHandleService,
    ) => unknown;
  },
  handles: AssetHandleService | undefined,
): unknown {
  if (!definition.assetize) return value;
  if (!handles) {
    throw new Error("Asset handle service is unavailable.");
  }
  return definition.assetize(value, args, handles);
}

function encodePathSegment(value: unknown, key: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`Path argument '${key}' must be a string or number.`);
  }

  const text = String(value);
  if (
    text === "" ||
    text === "." ||
    text === ".." ||
    /[/\\\r\n\0]/.test(text)
  ) {
    throw new Error(`Path argument '${key}' is not a valid URL path segment.`);
  }
  return encodeURIComponent(text);
}

export function renderCatalogPath(
  template: string,
  args: Record<string, unknown>,
): string {
  if (
    !template.startsWith("/") ||
    !template.endsWith("/") ||
    template.startsWith("//") ||
    template.slice(1).includes("//") ||
    template.includes("..") ||
    /[?#\r\n\0]/.test(template)
  ) {
    throw new Error(
      `Catalog path template must be an absolute, trailing-slash API path: ${template}`,
    );
  }

  const rendered = template.replace(
    /\{([A-Za-z][A-Za-z0-9]*)\}/g,
    (_placeholder, key: string) => encodePathSegment(args[key], key),
  );
  if (rendered.includes("{") || rendered.includes("}")) {
    throw new Error(
      `Catalog path template contains an invalid placeholder: ${template}`,
    );
  }
  return rendered;
}

export function buildCatalogQuery<InputSchema extends AnyZodObject>(
  mapping: ReadRouteDefinition<InputSchema>["query"],
  args: Record<string, unknown>,
  fixedQuery?: ReadRouteDefinition<InputSchema>["fixedQuery"],
): Record<string, string> | undefined {
  const query: Record<string, string> = {};
  if (mapping) {
    for (const [inputKey, queryKey] of Object.entries(mapping)) {
      if (queryKey === undefined) continue;
      const value = args[inputKey];
      if (value === undefined || value === null) continue;
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
        throw new Error(
          `Query argument '${inputKey}' must be a string, number, or boolean.`,
        );
      }
      query[queryKey] = String(value);
    }
  }
  // These are route invariants, not defaults: a mapped caller argument must
  // never be able to override a fixed filter or safety cap.
  Object.assign(query, fixedQuery);
  return Object.keys(query).length > 0 ? query : undefined;
}

async function executeCatalogRoute<InputSchema extends AnyZodObject>(
  transport: ReturnType<GetClient>["transport"],
  route: ReadRouteDefinition<InputSchema>,
  args: Record<string, unknown>,
): Promise<unknown> {
  const path = renderCatalogPath(route.path, args);
  const query = buildCatalogQuery(route.query, args, route.fixedQuery);
  return route.response === "page"
    ? transport.requestPage<Record<string, unknown>>(path, query)
    : route.response === "list"
      ? transport.requestList<Record<string, unknown>>(path, query)
      : query
        ? transport.requestSingle<Record<string, unknown>>(path, query)
        : transport.requestSingle<Record<string, unknown>>(path);
}

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/**
 * Validate the REST result, redact sensitive keys recursively, then validate
 * again so MCP structured content cannot leak a credential or violate the
 * tool's advertised output schema after redaction.
 */
function parseSafeStructuredContent<OutputSchema extends AnyZodObject>(
  outputSchema: OutputSchema,
  value: unknown,
): z.infer<OutputSchema> {
  const parsed = outputSchema.parse(value);
  return outputSchema.parse(sanitizeForOutput(parsed)) as z.infer<OutputSchema>;
}

/**
 * Register one declarative read tool.
 *
 * The route definition is executable configuration: it builds the path and
 * query and selects the SDK transport method. Tool metadata and the actual
 * HTTP call therefore cannot drift into separate hand-written code paths.
 */
export function registerReadCatalogTool<
  InputSchema extends AnyZodObject,
  OutputSchema extends AnyZodObject,
>(
  server: McpServer,
  getClient: GetClient,
  definition: ReadCatalogToolDefinition<InputSchema, OutputSchema>,
  assetHandles?: AssetHandleService,
): void {
  const inputSchema = withReadDetailInput(
    definition.inputSchema,
    definition.supportsDetail,
  );
  const handler = async (
    args: z.infer<InputSchema>,
  ): Promise<CallToolResult> => {
    const requestArgs = applyReadListDefaults(
      args as Record<string, unknown>,
      definition.route,
    );
    const raw = await executeCatalogRoute(
      getClient(definition.name).transport,
      definition.route,
      requestArgs,
    );
    const structuredContent = parseSafeStructuredContent(
      definition.outputSchema,
      assetizeCatalogResult(
        definition.route.response === "list" ? { items: raw } : raw,
        requestArgs,
        definition,
        assetHandles,
      ),
    );
    const presented = presentCatalogResult(
      structuredContent,
      requestArgs,
      definition,
    );
    const textContent =
      definition.route.response === "list"
        ? (presented as { items: Record<string, unknown>[] }).items
        : presented;
    return {
      structuredContent: presented as Record<string, unknown>,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(textContent, null, 2) ?? "{}",
        },
      ],
    };
  };

  server.registerTool<OutputSchema, InputSchema>(
    definition.name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema,
      outputSchema: definition.outputSchema,
      annotations: { title: definition.title, ...READ_ONLY_ANNOTATIONS },
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

/**
 * Register a read-only tool composed from multiple declared REST routes.
 *
 * The executor receives only a name-based reader. It cannot issue an
 * undeclared transport call, and every call is rendered from the same route
 * metadata exposed to MCP clients and checked against the Django manifest.
 */
export function registerCompositeReadCatalogTool<
  InputSchema extends AnyZodObject,
  OutputSchema extends AnyZodObject,
>(
  server: McpServer,
  getClient: GetClient,
  definition: CompositeReadCatalogToolDefinition<InputSchema, OutputSchema>,
  assetHandles?: AssetHandleService,
): void {
  const inputSchema = withReadDetailInput(
    definition.inputSchema,
    definition.supportsDetail,
  );
  const routes = new Map<string, ReadRouteDefinition<InputSchema>>();
  for (const route of definition.routes) {
    if (routes.has(route.name)) {
      throw new Error(
        `Composite catalog tool '${definition.name}' declares route '${route.name}' more than once.`,
      );
    }
    routes.set(route.name, route);
  }

  const handler = async (
    args: z.infer<InputSchema>,
  ): Promise<CallToolResult> => {
    const requestArgs = applyReadListDefaults(
      args as Record<string, unknown>,
      definition.routes[0],
    );
    const transport = getClient(definition.name).transport;
    const read: CompositeRouteReader = async (routeName) => {
      const route = routes.get(routeName);
      if (!route) {
        throw new Error(
          `Composite catalog tool '${definition.name}' tried to read undeclared route '${routeName}'.`,
        );
      }
      return executeCatalogRoute(transport, route, requestArgs);
    };
    const structuredContent = parseSafeStructuredContent(
      definition.outputSchema,
      assetizeCatalogResult(
        await definition.execute(requestArgs as z.infer<InputSchema>, read),
        requestArgs,
        definition,
        assetHandles,
      ),
    );
    const presented = presentCatalogResult(
      structuredContent,
      requestArgs,
      definition,
    );
    return {
      structuredContent: presented as Record<string, unknown>,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(presented, null, 2) ?? "{}",
        },
      ],
    };
  };

  const scopes = [...new Set(definition.routes.map((route) => route.scope))];
  const toolsets = [
    ...new Set(definition.routes.map((route) => route.toolset)),
  ];
  const meta: Record<string, unknown> = {
    "avala.ai/rest-routes": definition.routes.map((route) => route.name),
    "avala.ai/rest-methods": definition.routes.map((route) => route.method),
    "avala.ai/required-scopes": scopes,
    "avala.ai/toolsets": toolsets,
  };
  if (scopes.length === 1) meta["avala.ai/required-scope"] = scopes[0];
  if (toolsets.length === 1) meta["avala.ai/toolset"] = toolsets[0];

  server.registerTool<OutputSchema, InputSchema>(
    definition.name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema,
      outputSchema: definition.outputSchema,
      annotations: { title: definition.title, ...READ_ONLY_ANNOTATIONS },
      _meta: meta,
    },
    handler as unknown as ToolCallback<InputSchema>,
  );
}

export { resolveReadDetail };
