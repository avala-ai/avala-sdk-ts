import type { McpServer } from "@modelcontextprotocol/server";
import type { GetClient } from "../client.js";
import {
  assetReferenceSchema,
  createAssetHandleService,
  identityBoundAssetReferenceFor,
  type AssetHandleService,
} from "../assetHandles.js";
import {
  definePageOutputSchema,
  defineReadCatalogTool,
  registerReadCatalogTool,
} from "../catalog.js";
import { z } from "zod";

const organizationIdentitySchema = {
  uid: z.string(),
  name: z.string(),
  slug: z.string(),
  handle: z.string().nullable(),
  logoAsset: assetReferenceSchema.nullable(),
  industry: z.string().nullable(),
  visibility: z.string().nullable(),
  plan: z.string().nullable(),
  isVerified: z.boolean(),
  isActive: z.boolean(),
  memberCount: z.number().nullable(),
  teamCount: z.number().nullable(),
  role: z.string().nullable(),
  billingStatus: z.string().nullable(),
  createdAt: z.string().nullable(),
};

const organizationListOutputSchema = z
  .object({
    ...organizationIdentitySchema,
    joinedAt: z.string().nullable(),
    publicSlug: z.string().nullable(),
  })
  .passthrough();

const organizationDetailOutputSchema = z
  .object({
    ...organizationIdentitySchema,
    description: z.string().nullable(),
    website: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    datasetCount: z.number().nullable(),
    projectCount: z.number().nullable(),
    sliceCount: z.number().nullable(),
    allowedDomains: z.array(z.string()).nullable(),
    slugEditsRemaining: z.number().nullable(),
    updatedAt: z.string().nullable(),
  })
  .passthrough();

const ORGANIZATION_CONCISE_KEYS = [
  "uid",
  "name",
  "slug",
  "handle",
  "plan",
  "role",
  "memberCount",
  "isActive",
  "updatedAt",
] as const;

function assetizeOrganization(
  value: unknown,
  handles: AssetHandleService,
): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const { logo, ...rest } = record;
  if (typeof record.slug !== "string") return rest;
  const slug = record.slug;
  return {
    ...rest,
    logoAsset: identityBoundAssetReferenceFor(
      logo,
      (identity) => ({
        kind: "organization_asset",
        slug,
        identity,
        path: ["logo"],
      }),
      handles,
    ),
  };
}

function assetizeOrganizationResult(
  value: unknown,
  _args: Readonly<Record<string, unknown>>,
  handles: AssetHandleService,
): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  return Array.isArray(record.items)
    ? {
        ...record,
        items: record.items.map((item) =>
          assetizeOrganization(item, handles),
        ),
      }
    : assetizeOrganization(record, handles);
}

const listOrganizationsTool = defineReadCatalogTool({
  name: "list_organizations",
  title: "List organizations",
  description:
    "List organizations you are a member of. Default detail is identity, plan, and membership. Opaque logo-asset handles and contact fields require detail=full.",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Maximum number of organizations to return. Defaults to 25 when omitted.",
      ),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor from a previous request"),
  }),
  outputSchema: definePageOutputSchema(organizationListOutputSchema),
  assetize: assetizeOrganizationResult,
  conciseKeys: ORGANIZATION_CONCISE_KEYS,
  route: {
    name: "organization-list-create",
    method: "GET",
    path: "/organizations/",
    query: { limit: "limit", cursor: "cursor" },
    response: "page",
    scope: "organizations.read",
    toolset: "organizations",
  },
});

const getOrganizationTool = defineReadCatalogTool({
  name: "get_organization",
  title: "Get organization",
  description:
    "Get an organization. Default detail is identity and counts. Use detail=full for contact fields, domains, and an opaque logo-asset handle.",
  inputSchema: z.object({
    slug: z.string().describe("The slug identifier of the organization"),
  }),
  outputSchema: organizationDetailOutputSchema,
  assetize: assetizeOrganizationResult,
  conciseKeys: ORGANIZATION_CONCISE_KEYS,
  route: {
    name: "organization-detail",
    method: "GET",
    path: "/organizations/{slug}/",
    response: "single",
    scope: "organizations.read",
    toolset: "organizations",
  },
});

export const ORGANIZATION_READ_CATALOG_TOOLS = [
  listOrganizationsTool,
  getOrganizationTool,
] as const;

export function registerOrganizationTools(
  server: McpServer,
  getClient: GetClient,
  assetHandles: AssetHandleService = createAssetHandleService(),
): void {
  registerReadCatalogTool(
    server,
    getClient,
    listOrganizationsTool,
    assetHandles,
  );
  registerReadCatalogTool(
    server,
    getClient,
    getOrganizationTool,
    assetHandles,
  );
}
