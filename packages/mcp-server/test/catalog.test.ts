import { describe, expect, it, vi } from "vitest";
import routeManifest from "../../../../../server/api_route_manifest.json";
import { buildCatalogQuery, renderCatalogPath } from "../src/catalog.js";
import { AGENT_READ_CATALOG_TOOLS, registerAgentTools } from "../src/tools/agents.js";
import { CONSENSUS_READ_CATALOG_TOOLS, registerConsensusTools } from "../src/tools/consensus.js";
import { DATASET_READ_CATALOG_TOOLS, registerDatasetTools } from "../src/tools/datasets.js";
import { FLEET_READ_CATALOG_TOOLS, registerFleetTools } from "../src/tools/fleet.js";
import {
  ORGANIZATION_READ_CATALOG_TOOLS,
  registerOrganizationTools,
} from "../src/tools/organizations.js";
import { QUALITY_READ_CATALOG_TOOLS, registerQualityTools } from "../src/tools/quality.js";
import { registerSliceTools, SLICE_READ_CATALOG_TOOLS } from "../src/tools/slices.js";
import { registerStorageTools, STORAGE_READ_CATALOG_TOOLS } from "../src/tools/storage.js";
import { registerTaskTools, TASK_READ_CATALOG_TOOLS } from "../src/tools/tasks.js";
import { registerWebhookTools, WEBHOOK_READ_CATALOG_TOOLS } from "../src/tools/webhooks.js";

interface ManifestRoute {
  methods: string[];
  name: string;
  path: string;
  scope_enforced_domain?: string | null;
  shadow_scope_domain?: string | null;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}>;

const SAMPLE_ARGS: Record<string, Record<string, unknown>> = {
  list_datasets: { limit: 5, cursor: "next-page" },
  get_dataset: { uid: "00000000-0000-0000-0000-000000000001" },
  list_sequences: { owner: "robotics-team", slug: "warehouse-bags", limit: 10 },
  get_sequence: {
    owner: "robotics-team",
    slug: "warehouse-bags",
    sequenceUid: "00000000-0000-0000-0000-000000000002",
  },
  get_dataset_health: { owner: "robotics-team", slug: "warehouse-bags" },
  list_slices: { owner: "robotics-team", limit: 10 },
  get_slice: { owner: "robotics-team", slug: "training-set" },
  list_tasks: { project: "00000000-0000-0000-0000-000000000003", status: "active", limit: 10 },
  get_task: { uid: "00000000-0000-0000-0000-000000000004" },
  list_organizations: { limit: 10 },
  get_organization: { slug: "robotics-team" },
  list_agents: { limit: 10 },
  get_agent: { uid: "00000000-0000-0000-0000-000000000005" },
  list_webhooks: { limit: 10 },
  list_storage_configs: { limit: 10 },
  list_quality_targets: { projectUid: "00000000-0000-0000-0000-000000000006", limit: 10 },
  get_consensus_summary: { projectUid: "00000000-0000-0000-0000-000000000007" },
  fleet_list_devices: { status: "online", type: "camera", limit: 10 },
  fleet_get_device: { uid: "00000000-0000-0000-0000-000000000008" },
  fleet_list_recordings: {
    device: "00000000-0000-0000-0000-000000000008",
    status: "ready",
    limit: 10,
  },
  fleet_get_recording: { uid: "00000000-0000-0000-0000-000000000009" },
  fleet_list_events: {
    recording: "00000000-0000-0000-0000-000000000009",
    device: "00000000-0000-0000-0000-000000000008",
    type: "hard_brake",
    severity: "warning",
    limit: 10,
  },
  fleet_list_alerts: {
    status: "open",
    severity: "warning",
    device: "00000000-0000-0000-0000-000000000008",
    rule: "00000000-0000-0000-0000-000000000010",
    limit: 10,
  },
  fleet_list_rules: { enabled: true, limit: 10 },
};

const READ_CATALOG_TOOLS = [
  ...DATASET_READ_CATALOG_TOOLS,
  ...SLICE_READ_CATALOG_TOOLS,
  ...TASK_READ_CATALOG_TOOLS,
  ...ORGANIZATION_READ_CATALOG_TOOLS,
  ...AGENT_READ_CATALOG_TOOLS,
  ...WEBHOOK_READ_CATALOG_TOOLS,
  ...STORAGE_READ_CATALOG_TOOLS,
  ...QUALITY_READ_CATALOG_TOOLS,
  ...CONSENSUS_READ_CATALOG_TOOLS,
  ...FLEET_READ_CATALOG_TOOLS,
] as const;

const SCOPE_BY_DOMAIN: Record<string, string> = {
  dataset: "datasets.read",
  slice: "slices.read",
  task: "tasks.read",
  organization: "organizations.read",
  agent: "agents.read",
  webhook: "webhooks.read",
  storage: "storage.read",
  quality_control: "qc.read",
  fleet: "fleet.read",
};

const TOOLSET_BY_DOMAIN: Record<string, string> = {
  dataset: "datasets",
  slice: "slices",
  task: "tasks",
  organization: "organizations",
  agent: "agents",
  webhook: "webhooks",
  storage: "storage",
  quality_control: "quality",
  fleet: "fleet",
};

function manifestPathPattern(path: string): RegExp {
  let pattern = path.replace(/^api\/v1\//, "");
  if (pattern.startsWith("^")) pattern = pattern.slice(1);
  if (pattern.endsWith("$")) pattern = pattern.slice(0, -1);
  pattern = pattern.replace(/\(\?P<[^>]+>/g, "(?:");
  pattern = pattern.replace(/<[^>]+>/g, "[^/]+");
  return new RegExp(`^/${pattern}$`);
}

describe("declarative MCP catalog", () => {
  it("pins dataset reads to the route manifest and the transport calls they execute", async () => {
    const registrations = new Map<string, { config: Record<string, unknown>; handler: ToolHandler }>();
    const calls: { method: "GET"; path: string; query?: Record<string, string> }[] = [];
    const sampleEntity = {
      uid: "result",
      name: "Result dataset",
      slug: "result-dataset",
      itemCount: 1,
      dataType: "image",
      type: "image_classification",
      project: "project-result",
      createdAt: "2026-08-24T00:00:00Z",
      updatedAt: "2026-08-24T00:00:00Z",
      handle: null,
      logo: null,
      industry: "robotics",
      plan: "enterprise",
      isVerified: true,
      isActive: true,
      memberCount: 5,
      teamCount: 2,
      role: "owner",
      billingStatus: "active",
      joinedAt: "2026-08-24T00:00:00Z",
      publicSlug: "result-dataset",
      description: "Robotics team",
      website: "https://example.com",
      email: null,
      phone: null,
      datasetCount: 1,
      projectCount: 1,
      sliceCount: 1,
      allowedDomains: ["example.com"],
      slugEditsRemaining: 3,
      events: ["task.completed"],
      callbackUrl: "https://example.com/agent-callback",
      taskTypes: ["annotation"],
      executionStats: { completed: 1 },
      targetUrl: "https://example.com/webhook",
      provider: "aws_s3",
      s3BucketName: "robotics-data",
      s3BucketRegion: "us-west-2",
      s3BucketPrefix: "datasets/",
      s3IsAccelerated: false,
      s3AuthMethod: "iam_role",
      gcStorageBucketName: null,
      r2AccountId: null,
      r2PublicBaseUrl: null,
      lastVerifiedAt: "2026-08-24T00:00:00Z",
      metric: "acceptance_rate",
      operator: "gte",
      threshold: 0.95,
      severity: "warning",
      notifyWebhook: true,
      notifyEmails: ["quality@example.com"],
      lastEvaluatedAt: "2026-08-24T00:00:00Z",
      lastValue: 0.97,
      isBreached: false,
      breachCount: 0,
      lastBreachedAt: null,
      meanScore: 0.9,
      medianScore: 0.92,
      minScore: 0.7,
      maxScore: 1,
      totalItems: 10,
      itemsWithConsensus: 8,
      scoreDistribution: { "0.8-1.0": 8 },
      byTaskName: [{ taskName: "label", meanScore: 0.9, count: 8 }],
      tags: ["warehouse"],
      firmwareVersion: "1.0.0",
      metadata: { location: "warehouse" },
      lastSeenAt: "2026-08-24T00:00:00Z",
      device: "00000000-0000-0000-0000-000000000008",
      durationSeconds: 60,
      sizeBytes: 1024,
      topicCount: 2,
      topics: [{ name: "/camera/front" }],
      startedAt: "2026-08-24T00:00:00Z",
      endedAt: "2026-08-24T00:01:00Z",
      recording: "00000000-0000-0000-0000-000000000009",
      label: "Hard brake",
      timestamp: "2026-08-24T00:00:30Z",
      durationMs: 500,
      rule: "00000000-0000-0000-0000-000000000010",
      message: "Threshold exceeded",
      triggeredAt: "2026-08-24T00:00:30Z",
      acknowledgedAt: null,
      acknowledgedBy: null,
      resolvedAt: null,
      resolutionNote: null,
      enabled: true,
      condition: { type: "threshold" },
      actions: [{ type: "webhook" }],
      scope: { deviceTypes: ["camera"] },
      hitCount: 1,
      lastHitAt: null,
      ownerName: "robotics-team",
      organization: null,
      visibility: "private",
      subSlices: [],
      sourceData: [],
      featuredSliceItemUrls: [],
      customUuid: null,
      key: "sequence-key",
      status: "created",
      featuredImage: null,
      numberOfFrames: 1,
      predefinedLabels: [],
      frames: [],
      metrics: null,
      datasetUid: "result",
      allowLidarCalibration: false,
      lidarCalibrationEnabled: false,
      cameraCalibrationEnabled: false,
      cropData: null,
      datasetSlug: "result-dataset",
      datasetStatus: "created",
      sequenceCount: 0,
      totalFrames: 0,
      s3Prefix: null,
      gcStoragePrefix: null,
      lastUpdatedAt: null,
      sequences: [],
      ingestOk: true,
      issues: [],
    };
    const transport = {
      requestPage: vi.fn(async (path: string, query?: Record<string, string>) => {
        calls.push({ method: "GET", path, query });
        return { items: [sampleEntity], nextCursor: null, previousCursor: null, hasMore: false };
      }),
      requestSingle: vi.fn(async (path: string) => {
        calls.push({ method: "GET", path });
        return sampleEntity;
      }),
    };
    const server = {
      tool: vi.fn(),
      registerTool: vi.fn((name: string, config: Record<string, unknown>, handler: ToolHandler) => {
        registrations.set(name, { config, handler });
      }),
    };
    registerDatasetTools(server as never, (() => ({ transport })) as never, true);
    registerSliceTools(server as never, (() => ({ transport })) as never);
    registerTaskTools(server as never, (() => ({ transport })) as never);
    registerOrganizationTools(server as never, (() => ({ transport })) as never);
    registerAgentTools(server as never, (() => ({ transport })) as never);
    registerWebhookTools(server as never, (() => ({ transport })) as never);
    registerStorageTools(server as never, (() => ({ transport })) as never);
    registerQualityTools(server as never, (() => ({ transport })) as never);
    registerConsensusTools(server as never, (() => ({ transport })) as never);
    registerFleetTools(server as never, (() => ({ transport })) as never);

    for (const definition of READ_CATALOG_TOOLS) {
      const manifestRoute = (routeManifest as ManifestRoute[]).find((route) => route.name === definition.route.name);
      expect(manifestRoute, `${definition.name} route is absent from the server manifest`).toBeDefined();
      expect(manifestRoute!.methods).toContain(definition.route.method.toLowerCase());

      const scopeDomain = manifestRoute!.scope_enforced_domain ?? manifestRoute!.shadow_scope_domain;
      expect(scopeDomain).toBeDefined();
      expect(definition.route.scope).toBe(SCOPE_BY_DOMAIN[scopeDomain!]);
      const expectedToolset = manifestRoute!.path.includes("/sequences/")
        ? "sequences"
        : manifestRoute!.path.includes("/consensus/")
          ? "consensus"
          : TOOLSET_BY_DOMAIN[scopeDomain!];
      expect(definition.route.toolset).toBe(expectedToolset);

      const registration = registrations.get(definition.name)!;
      const config = registration.config as {
        annotations: Record<string, unknown>;
        outputSchema: unknown;
        _meta: Record<string, unknown>;
      };
      expect(config.outputSchema).toBe(definition.outputSchema);
      expect(config.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      });
      expect(config._meta).toMatchObject({
        "avala.ai/rest-route": definition.route.name,
        "avala.ai/rest-method": definition.route.method,
        "avala.ai/required-scope": definition.route.scope,
        "avala.ai/toolset": definition.route.toolset,
      });

      const callCount = calls.length;
      const result = await registration.handler(SAMPLE_ARGS[definition.name]!);
      expect(calls).toHaveLength(callCount + 1);
      const actualCall = calls.at(-1)!;
      expect(actualCall.method).toBe(definition.route.method);
      expect(actualCall.path).toBe(renderCatalogPath(definition.route.path, SAMPLE_ARGS[definition.name]!));
      expect(actualCall.query).toEqual(buildCatalogQuery(definition.route.query, SAMPLE_ARGS[definition.name]!));
      expect(manifestPathPattern(manifestRoute!.path).test(actualCall.path)).toBe(true);
      expect(result.structuredContent).toBeDefined();
      expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
    }
  });

  it("encodes one path segment and rejects values that could change routes", () => {
    expect(renderCatalogPath("/datasets/{owner}/{slug}/", { owner: "person@example.com", slug: "bag 1" })).toBe(
      "/datasets/person%40example.com/bag%201/",
    );
    expect(() => renderCatalogPath("/datasets/{owner}/", { owner: "../admin" })).toThrow(
      "not a valid URL path segment",
    );
    expect(() => renderCatalogPath("/datasets/{owner}/", {})).toThrow("must be a string or number");
    expect(() => renderCatalogPath("//attacker.example/{owner}/", { owner: "safe" })).toThrow(
      "must be an absolute, trailing-slash API path",
    );
    expect(() => renderCatalogPath("/datasets/{not-valid}/", {})).toThrow("contains an invalid placeholder");
  });

  it("maps only present primitive query arguments", () => {
    expect(
      buildCatalogQuery(
        { dataType: "data_type", limit: "limit", cursor: "cursor" },
        { dataType: "mcap", limit: 25, cursor: undefined },
      ),
    ).toEqual({ data_type: "mcap", limit: "25" });
  });
});
