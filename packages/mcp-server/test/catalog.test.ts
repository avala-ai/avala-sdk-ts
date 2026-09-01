import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  buildCatalogQuery,
  defineCompositeReadCatalogTool,
  defineListOutputSchema,
  defineReadCatalogTool,
  registerCompositeReadCatalogTool,
  registerReadCatalogTool,
  renderCatalogPath,
} from "../src/catalog.js";
import {
  AGENT_READ_CATALOG_TOOLS,
  registerAgentTools,
} from "../src/tools/agents.js";
import {
  ANNOTATION_ISSUE_READ_CATALOG_TOOLS,
  registerAnnotationIssueTools,
} from "../src/tools/annotationIssues.js";
import {
  CONSENSUS_READ_CATALOG_TOOLS,
  registerConsensusTools,
} from "../src/tools/consensus.js";
import {
  DATASET_READ_CATALOG_TOOLS,
  registerDatasetTools,
} from "../src/tools/datasets.js";
import {
  EXPORT_READ_CATALOG_TOOLS,
  registerExportTools,
} from "../src/tools/exports.js";
import {
  FLEET_READ_CATALOG_TOOLS,
  registerFleetTools,
} from "../src/tools/fleet.js";
import {
  ORGANIZATION_READ_CATALOG_TOOLS,
  registerOrganizationTools,
} from "../src/tools/organizations.js";
import {
  QUALITY_READ_CATALOG_TOOLS,
  registerQualityTools,
} from "../src/tools/quality.js";
import {
  registerSliceTools,
  SLICE_READ_CATALOG_TOOLS,
} from "../src/tools/slices.js";
import {
  registerStorageTools,
  STORAGE_READ_CATALOG_TOOLS,
} from "../src/tools/storage.js";
import {
  registerTaskTools,
  TASK_READ_CATALOG_TOOLS,
} from "../src/tools/tasks.js";
import {
  registerWebhookTools,
  WEBHOOK_READ_CATALOG_TOOLS,
} from "../src/tools/webhooks.js";
import { WORKFLOW_COMPOSITE_READ_CATALOG_TOOLS } from "../src/tools/workflows.js";
import {
  registerWorkforceTools,
  WORKFORCE_MUTATION_CATALOG_TOOLS,
  WORKFORCE_READ_CATALOG_TOOLS,
} from "../src/tools/workforce.js";

interface ManifestRoute {
  app: string;
  declares_scope?: string[];
  methods: string[];
  mcp_idempotent_mutation_methods?: string[];
  name: string;
  path: string;
  scope_enforced_domain?: string | null;
  shadow_scope_domain?: string | null;
}

const routeManifestPath = fileURLToPath(
  new URL("../../../../../server/api_route_manifest.json", import.meta.url),
);
const monorepoAvailable = existsSync(
  fileURLToPath(new URL("../../../../../DOCTRINE.md", import.meta.url)),
);
const routeManifestAvailable = existsSync(routeManifestPath);
if (monorepoAvailable && !routeManifestAvailable) {
  throw new Error("Monorepo API route manifest is missing.");
}
const routeManifest = routeManifestAvailable
  ? (JSON.parse(readFileSync(routeManifestPath, "utf8")) as ManifestRoute[])
  : [];

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
  preview_curation_candidates: {
    datasetUid: "00000000-0000-0000-0000-000000000001",
    unit: "sequence",
    qcDimension: "sequence_workflow",
    requiredState: "customer_approved",
    limit: 10,
  },
  list_capture_submissions: {
    datasetUid: "00000000-0000-0000-0000-000000000020",
    status: "pending",
    limit: 10,
  },
  get_capture_submission: { resultUid: "00000000-0000-0000-0000-000000000021" },
  list_capture_campaigns: {
    datasetUid: "00000000-0000-0000-0000-000000000020",
  },
  list_slices: { owner: "robotics-team", limit: 10 },
  get_slice: { owner: "robotics-team", slug: "training-set" },
  list_tasks: {
    project: "00000000-0000-0000-0000-000000000003",
    status: "active",
    limit: 10,
  },
  get_task: { uid: "00000000-0000-0000-0000-000000000004" },
  list_organizations: { limit: 10 },
  get_organization: { slug: "robotics-team" },
  list_agents: { limit: 10 },
  get_agent: { uid: "00000000-0000-0000-0000-000000000005" },
  list_webhooks: { limit: 10 },
  list_storage_configs: { limit: 10 },
  list_quality_targets: {
    projectUid: "00000000-0000-0000-0000-000000000006",
    limit: 10,
  },
  get_result_acceptance: { resultUid: "00000000-0000-0000-0000-000000000019" },
  get_campaign_acceptance_summary: {
    projectUid: "00000000-0000-0000-0000-000000000006",
  },
  get_campaign_acceptance_coverage: {
    projectUid: "00000000-0000-0000-0000-000000000006",
    axes: "subject,device_tier",
  },
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
  list_annotation_issues_by_sequence: {
    sequenceUid: "00000000-0000-0000-0000-000000000011",
    datasetItemUid: "00000000-0000-0000-0000-000000000012",
    projectUid: "00000000-0000-0000-0000-000000000013",
  },
  list_annotation_issues_by_dataset: {
    owner: "robotics-team",
    datasetSlug: "warehouse-bags",
    sequenceUid: "00000000-0000-0000-0000-000000000011",
  },
  get_annotation_issue_metrics: {
    owner: "robotics-team",
    datasetSlug: "warehouse-bags",
    sequenceUid: "00000000-0000-0000-0000-000000000011",
  },
  list_qc_tools: { datasetType: "lidar" },
  list_exports: { limit: 10, cursor: "next-page" },
  get_export_status: { uid: "00000000-0000-0000-0000-000000000018" },
  get_workforce_operations_overview: {
    windowDays: 14,
    attentionLimit: 5,
  },
  get_workforce_batch_attention: {
    batchUid: "00000000000000000000000000000001",
  },
  list_workforce_batches: {
    organizationUid: "00000000000000000000000000000002",
    projectUid: "00000000000000000000000000000003",
    datasetUid: "00000000000000000000000000000004",
    sequenceUid: "00000000000000000000000000000005",
    status: "available",
    priority: "high",
    limit: 25,
    cursor: "00000000000000000000000000000006",
  },
  list_workforce_groups: {
    search: "lidar",
    hasActiveApprovedCoworkers: true,
    limit: 25,
    cursor: "00000000000000000000000000000006",
  },
  list_workforce_group_members: {
    groupUid: "00000000000000000000000000000006",
    active: true,
    approved: true,
    hasActiveWork: false,
    limit: 25,
    cursor: "00000000000000000000000000000007",
  },
  preview_workforce_group_membership_impact: {
    groupUid: "00000000000000000000000000000006",
    coworkerUid: "00000000000000000000000000000007",
    operation: "remove",
    limit: 25,
    cursor: "00000000000000000000000000000008",
  },
  list_workforce_batch_units: {
    batchUid: "00000000000000000000000000000001",
    status: "in_progress",
    assigned: true,
    workflowRole: "review",
    limit: 25,
    cursor: "00000000000000000000000000000002",
  },
  get_workforce_sequence_status: {
    sequenceUid: "00000000000000000000000000000005",
  },
  list_workforce_assignment_candidates: {
    workUnitUid: "00000000000000000000000000000006",
    windowDays: 14,
    limit: 25,
    cursor: "00000000000000000000000000000007",
  },
  list_workforce_batch_staffing_candidates: {
    batchUid: "00000000000000000000000000000001",
    allocated: false,
    windowDays: 14,
    limit: 25,
    cursor: "00000000000000000000000000000007",
  },
  list_workforce_batch_coworker_activity: {
    batchUid: "00000000000000000000000000000001",
    allocated: true,
    windowDays: 14,
    limit: 25,
    cursor: "00000000000000000000000000000007",
  },
  preview_workforce_batch_allocation_impact: {
    batchUid: "00000000000000000000000000000001",
    coworkerUid: "00000000000000000000000000000007",
    operation: "add",
  },
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
  ...ANNOTATION_ISSUE_READ_CATALOG_TOOLS,
  ...EXPORT_READ_CATALOG_TOOLS,
  ...WORKFORCE_READ_CATALOG_TOOLS,
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
  export: "exports.read",
  workforce: "workforce.read",
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
  export: "exports",
  workforce: "staff",
};

function expectedToolsetForRoute(
  route: ManifestRoute,
  scopeDomain: string | null | undefined,
): string | undefined {
  if (route.name.startsWith("workforce-")) return "staff";
  if (route.path.includes("/consensus/")) return "consensus";
  if (route.app === "quality_control") return "quality";
  if (route.path.includes("/sequences/")) return "sequences";
  if (!scopeDomain && route.app === "dataset") return "datasets";
  return scopeDomain ? TOOLSET_BY_DOMAIN[scopeDomain] : undefined;
}

function manifestPathPattern(path: string): RegExp {
  let pattern = path.replace(/^api\/v1\//, "");
  if (pattern.startsWith("^")) pattern = pattern.slice(1);
  if (pattern.endsWith("$")) pattern = pattern.slice(0, -1);
  pattern = pattern.replace(/\(\?P<[^>]+>/g, "(?:");
  pattern = pattern.replace(/<[^>]+>/g, "[^/]+");
  return new RegExp(`^/${pattern}$`);
}

describe("declarative MCP catalog", () => {
  it("registers and executes every catalog read through its declared transport", async () => {
    const registrations = new Map<
      string,
      { config: Record<string, unknown>; handler: ToolHandler }
    >();
    const calls: {
      method: "GET";
      path: string;
      query?: Record<string, string>;
    }[] = [];
    const sampleEntity = {
      uid: "result",
      name: "Result dataset",
      slug: "result-dataset",
      itemCount: 1,
      dataType: "image",
      isSequence: true,
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
      statusLabel: "Created",
      observedAt: "2026-08-24T00:00:00Z",
      workflowRevisionUid: null,
      transitionMode: "sequence",
      availableTransitions: [],
      featuredImage: null,
      numberOfFrames: 1,
      predefinedLabels: [],
      frames: [],
      metrics: null,
      datasetUid: "00000000000000000000000000000020",
      sequenceUid: "00000000000000000000000000000011",
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
      resultUid: "00000000-0000-0000-0000-000000000021",
      itemUid: "00000000000000000000000000000022",
      playbackUrl: "https://media.example/capture.mp4",
      mediaWidth: 1920,
      mediaHeight: 1080,
      durationS: 12.5,
      audio: true,
      submitter: {
        uid: "00000000-0000-0000-0000-000000000023",
        username: "operator",
      },
      submittedAt: "2026-08-24T00:00:00Z",
      rejectReason: null,
      rejectNote: null,
      reviewedBy: null,
      reviewedAt: null,
      episodeUid: null,
      extractionStatus: null,
      channels: null,
      thumbnailUrl: null,
      acceptance: {
        machineVerdict: "accept",
        blockingReasons: [],
        unmeasured: [],
        evaluatedAt: "2026-08-24T00:01:00Z",
      },
      campaign: {
        uid: "00000000-0000-0000-0000-000000000024",
        name: "Warehouse capture",
        taskDescription: {
          spec: "front-view",
          name: "Front view",
          config: {
            captureKind: "video",
            captureTier: "standard",
            camera: "rear",
            durationS: 15,
            audio: true,
            orientation: "landscape",
            clipsPerSession: 2,
            handGuardrail: true,
            handGuardrailMinHands: 2,
            subject: "warehouse tote",
            subjectByLocale: {},
            instructions: "Keep both hands in frame.",
            instructionsByLocale: {},
          },
        },
      },
    };
    const annotationIssue = {
      uid: "00000000-0000-0000-0000-000000000017",
      datasetItemUid: "00000000-0000-0000-0000-000000000012",
      sequenceUid: "00000000-0000-0000-0000-000000000011",
      project: {
        uid: "00000000-0000-0000-0000-000000000013",
        name: "Warehouse QC",
      },
      reporter: {
        username: "reviewer",
        picture: null,
        fullName: "Avala Reviewer",
        type: "customer",
        isStaff: false,
      },
      priority: "high",
      severity: "moderate",
      description: "Incorrect class",
      status: "open",
      tool: {
        uid: "00000000-0000-0000-0000-000000000014",
        name: "Cuboid",
        default: true,
      },
      problem: {
        uid: "00000000-0000-0000-0000-000000000015",
        title: "Wrong class",
      },
      wrongClass: "car",
      correctClass: "truck",
      shouldReAnnotate: true,
      shouldDelete: false,
      framesAffected: "1,2",
      coordinates: { x: 1, y: 2, z: 3 },
      queryParams: { camera: "front" },
      createdAt: "2026-08-24T00:00:00Z",
      closedAt: null,
      objectUid: "00000000-0000-0000-0000-000000000016",
    };
    const annotationIssueTool = {
      uid: "00000000-0000-0000-0000-000000000014",
      name: "Cuboid",
      datasetType: "lidar",
      default: true,
      problems: [
        {
          uid: "00000000-0000-0000-0000-000000000015",
          title: "Wrong class",
        },
      ],
    };
    const annotationIssueMetrics = {
      statusCount: { open: 3 },
      priorityCount: { high: 2, medium: 1 },
      severityCount: { critical: 1, moderate: 2 },
      meanSecondsCloseTimeAll: 120,
      meanSecondsCloseTimeCustomer: 150,
      meanUnresolvedIssueAgeAll: 300,
      meanUnresolvedIssueAgeCustomer: 360,
      objectCountByAnnotationIssueProblemUid: [
        {
          annotationIssueProblemUid: "00000000-0000-0000-0000-000000000015",
          count: 4,
        },
      ],
    };
    const exportItem = {
      uid: "00000000-0000-0000-0000-000000000018",
      name: "Warehouse labels",
      format: "avala-json-external",
      filterQueryString: null,
      totalTaskCount: 20,
      exportedTaskCount: 20,
      downloadUrl: "https://downloads.example.com/export.json",
      status: "exported",
      datasets: ["00000000-0000-0000-0000-000000000001"],
      slices: [],
      projects: ["00000000-0000-0000-0000-000000000013"],
      createdAt: "2026-08-24T00:00:00Z",
    };
    const captureProgress = {
      totalSlots: 2,
      notRecorded: 0,
      awaitingReview: 1,
      accepted: 1,
      rejected: 0,
      recaptureRequested: 0,
    };
    const captureConfig = {
      captureKind: "video",
      captureTier: "standard",
      camera: "rear",
      durationS: 15,
      audio: true,
      orientation: "landscape",
      clipsPerSession: 2,
      handGuardrail: true,
      handGuardrailMinHands: 2,
      subject: "warehouse tote",
      subjectByLocale: {},
      instructions: "Keep both hands in frame.",
      instructionsByLocale: {},
    };
    const captureCampaigns = {
      campaigns: [
        {
          projectUid: "00000000-0000-0000-0000-000000000025",
          name: "Warehouse capture",
          status: "active",
          createdAt: "2026-08-24T00:00:00Z",
          finishedAt: null,
          config: captureConfig,
          progress: captureProgress,
          canManage: true,
          taskDescriptions: [
            {
              spec: "front-view",
              name: "Front view",
              config: captureConfig,
              progress: captureProgress,
            },
          ],
        },
      ],
      progress: captureProgress,
    };
    const acceptanceSummary = {
      total: 2,
      byMachineVerdict: { accept: 1, reject: 1 },
      machineAcceptanceRate: 0.5,
      reviewed: 2,
      actualAcceptanceRate: 0.5,
      agreementRate: 1,
      agreement: {
        compared: 2,
        agreed: 2,
        agreementRate: 1,
        machineAbstained: 0,
        notReviewed: 0,
        confusion: { accept: { accept: 1 }, reject: { reject: 1 } },
        machineRejectedHumanAccepted: 0,
        machineAcceptedHumanRejected: 0,
      },
      byDeviceTier: [],
      byOperator: [],
      topRejectReasons: [{ reason: "too_short", count: 1 }],
    };
    const resultAcceptance = {
      resultUid: "00000000-0000-0000-0000-000000000019",
      machineVerdict: "quarantine",
      criteria: [
        {
          key: "capture_health",
          version: 1,
          status: "insufficient_evidence",
          reason: null,
          detail: {},
        },
      ],
      blockingReasons: [],
      unmeasured: ["capture_health"],
      engineVersion: 3,
      policyRevision: 2,
      signalsExtractorVersion: 4,
      evaluatedAt: "2026-08-24T00:00:00Z",
      signals: {
        status: "extracted",
        extractorVersion: 4,
        captureKind: "mcap",
        durationS: 180,
        channels: ["/camera/video"],
        deviceTier: "lidar_current",
        dedupSearched: true,
        axisValues: {},
        narrationScores: null,
      },
    };
    const acceptanceCoverage = {
      totalAccepted: 1,
      axes: [
        {
          axis: "subject",
          cells: [{ value: "fold laundry", count: 1 }],
          distinctValues: 1,
          unfilled: 0,
        },
      ],
    };
    const curationPreview = {
      datasetUid: "00000000000000000000000000000001",
      unit: "sequence",
      criterion: {
        dimension: "sequence_workflow",
        requiredState: "customer_approved",
        minimumConsensus: null,
        projectUid: null,
        taskName: null,
        deliverableId: null,
        deliverableStateField: null,
        evidenceStatus: "available",
      },
      candidateUids: [],
      counts: {
        selected: 0,
        excludedByMembership: 0,
        missingQcEvidence: 0,
        rejectedByThreshold: 0,
      },
      hasMore: false,
      nextCursor: null,
      limitations: [],
    };
    const workforceOperationsOverview = {
      generatedAt: "2026-08-29T20:00:00Z",
      window: { days: 14, startsAt: "2026-08-15T20:00:00Z" },
      coworkers: {
        total: 3,
        accountStatus: { active: 2, inactive: 1 },
        onboarding: {
          joinedInWindow: 1,
          loggedInInWindow: 2,
          neverLoggedIn: 1,
          phoneVerified: 2,
          phoneUnverified: 1,
          missingProfile: 0,
        },
        workRoles: { assignee: 2, reviewer: 1, dataCollection: 1 },
      },
      sessions: {
        createdInWindow: 4,
        workersInWindow: 2,
        byStatus: {
          pending: 0,
          ready: 0,
          assigned: 1,
          finished: 3,
          abandoned: 0,
        },
        expiredAssigned: 1,
      },
      workQueues: {
        batchesByStatus: { available: 1, unavailable: 1, archived: 0 },
        unitsByStatus: {
          unavailable: 0,
          backlog: 2,
          inProgress: 1,
          inReview: 1,
          completed: 10,
          error: 1,
        },
        unassignedBacklog: 2,
        attentionBatches: [
          {
            batchUid: "00000000000000000000000000000001",
            batchStatus: "available",
            priority: "high",
            errorUnits: 1,
            inReviewUnits: 1,
          },
        ],
      },
      attention: [
        {
          code: "errored_work_units",
          severity: "blocking",
          count: 1,
          remediation: "Inspect the affected batches.",
        },
      ],
    };
    const workforceBatchAttention = {
      generatedAt: "2026-08-29T20:00:00Z",
      batchUid: "00000000000000000000000000000001",
      batchStatus: "available",
      priority: "high",
      unitsByStatus: {
        unavailable: 0,
        backlog: 2,
        inProgress: 1,
        inReview: 0,
        completed: 10,
        error: 1,
      },
      unitsByRole: {
        firstPass: {
          unavailable: 0,
          backlog: 1,
          inProgress: 1,
          inReview: 0,
          completed: 10,
          error: 0,
        },
        review: {
          unavailable: 0,
          backlog: 1,
          inProgress: 0,
          inReview: 0,
          completed: 0,
          error: 0,
        },
        escalation: {
          unavailable: 0,
          backlog: 0,
          inProgress: 0,
          inReview: 0,
          completed: 0,
          error: 0,
        },
        unspecified: {
          unavailable: 0,
          backlog: 0,
          inProgress: 0,
          inReview: 0,
          completed: 0,
          error: 1,
        },
      },
      queueAge: {
        oldestBacklogUpdatedAt: {
          firstPass: "2026-08-29T18:00:00Z",
          review: "2026-08-29T19:00:00Z",
          escalation: null,
          unspecified: null,
        },
        oldestErrorUpdatedAt: "2026-08-29T17:00:00Z",
      },
      attention: {
        errorUnits: 1,
        reviewBacklogUnits: 1,
        escalationBacklogUnits: 0,
      },
    };
    const workforceBatchInventory = {
      generatedAt: "2026-08-29T20:00:00Z",
      batches: [
        {
          batchUid: "00000000000000000000000000000001",
          batchStatus: "available",
          priority: "high",
          staffingMode: "allocated",
          lineContext: {
            organizationUid: "00000000000000000000000000000002",
            projectUid: "00000000000000000000000000000003",
            datasetUid: "00000000000000000000000000000004",
            sequenceUid: "00000000000000000000000000000005",
          },
          unitsByStatus: {
            unavailable: 0,
            backlog: 2,
            inProgress: 1,
            inReview: 0,
            completed: 10,
            error: 1,
          },
          createdAt: "2026-08-28T20:00:00Z",
          updatedAt: "2026-08-29T19:58:00Z",
        },
      ],
      hasMore: false,
      nextCursor: null,
    };
    const workforceGroupCatalog = {
      generatedAt: "2026-08-29T20:00:00Z",
      groups: [
        {
          groupUid: "00000000000000000000000000000006",
          name: "first-pass-lidar",
          memberCounts: {
            coworkers: 12,
            activeCoworkers: 10,
            activeApprovedCoworkers: 8,
          },
        },
      ],
      hasMore: false,
      nextCursor: null,
    };
    const workforceGroupMembers = {
      generatedAt: "2026-08-29T20:00:00Z",
      groupUid: "00000000000000000000000000000006",
      members: [
        {
          coworkerUid: "00000000000000000000000000000007",
          displayName: "Ari",
          readiness: {
            active: true,
            approved: true,
            hasActiveWork: false,
          },
        },
      ],
      hasMore: false,
      nextCursor: null,
    };
    const workforceGroupMembershipImpact = {
      generatedAt: "2026-08-29T20:00:00Z",
      operation: "remove",
      groupUid: "00000000000000000000000000000006",
      coworkerUid: "00000000000000000000000000000007",
      currentMembership: true,
      readiness: {
        active: true,
        approved: true,
        hasActiveWork: false,
      },
      effect: {
        scope: "global_group",
        mayAffectPlatformCapabilities: true,
        wouldChangeMembership: true,
        coworkerReadyForNewWork: true,
        assignedInProgressGroupWorkUnits: 0,
        removalBlockedByActiveGroupWork: false,
      },
      affectedBatchesByStatus: {
        available: 1,
        unavailable: 0,
        archived: 0,
      },
      affectedGroupUnitsByStatus: {
        unavailable: 0,
        backlog: 2,
        inProgress: 0,
        inReview: 0,
        completed: 10,
        error: 0,
      },
      affectedBatches: [
        {
          batchUid: "00000000000000000000000000000008",
          batchStatus: "available",
          lineContext: {
            organizationUid: "00000000000000000000000000000002",
            projectUid: "00000000000000000000000000000003",
            datasetUid: "00000000000000000000000000000004",
            sequenceUid: "00000000000000000000000000000005",
          },
          groupUnitsByStatus: {
            unavailable: 0,
            backlog: 2,
            inProgress: 0,
            inReview: 0,
            completed: 10,
            error: 0,
          },
        },
      ],
      hasMore: false,
      nextCursor: null,
    };
    const workforceBatchUnits = {
      generatedAt: "2026-08-29T20:00:00Z",
      batchUid: "00000000000000000000000000000001",
      batchStatus: "available",
      lineContext: {
        organizationUid: "00000000000000000000000000000002",
        projectUid: "00000000000000000000000000000003",
        datasetUid: "00000000000000000000000000000004",
        sequenceUid: "00000000000000000000000000000005",
      },
      units: [
        {
          workUnitUid: "00000000000000000000000000000006",
          status: "in_progress",
          taskName: "cuboid",
          workflowRole: "review",
          assigned: true,
          updatedAt: "2026-08-29T19:58:00Z",
        },
      ],
      hasMore: false,
      nextCursor: null,
    };
    const workforceAssignmentCandidates = {
      generatedAt: "2026-08-29T20:00:00Z",
      batchUid: "00000000000000000000000000000001",
      batchStatus: "available",
      lineContext: {
        organizationUid: "00000000000000000000000000000002",
        projectUid: "00000000000000000000000000000003",
        datasetUid: "00000000000000000000000000000004",
        sequenceUid: "00000000000000000000000000000005",
      },
      workUnitUid: "00000000000000000000000000000006",
      workUnitStatus: "backlog",
      assigned: false,
      updatedAt: "2026-08-29T19:58:00Z",
      signalWindow: {
        days: 14,
        startsAt: "2026-08-15T20:00:00.000Z",
      },
      signalScope: {
        taskName: "cuboid",
        workflowRole: "review",
      },
      candidates: [
        {
          coworkerUid: "00000000000000000000000000000007",
          operationalSignals: {
            completedWorkUnits: 12,
            abandonedWorkUnits: 2,
            erroredWorkUnits: 1,
            lastCompletedAt: "2026-08-29T18:00:00Z",
          },
        },
      ],
      hasMore: false,
      nextCursor: null,
    };
    const workforceBatchStaffingCandidates = {
      generatedAt: "2026-08-29T20:00:00Z",
      batchUid: "00000000000000000000000000000001",
      batchStatus: "unavailable",
      staffingMode: "allocated",
      lineContext: {
        organizationUid: "00000000000000000000000000000002",
        projectUid: "00000000000000000000000000000003",
        datasetUid: "00000000000000000000000000000004",
        sequenceUid: "00000000000000000000000000000005",
      },
      signalWindow: {
        days: 14,
        startsAt: "2026-08-15T20:00:00.000Z",
      },
      signalScope: {
        organizationUid: "00000000000000000000000000000002",
        batchUid: "00000000000000000000000000000001",
      },
      candidates: [
        {
          coworkerUid: "00000000000000000000000000000007",
          currentAllocation: false,
          readiness: {
            active: true,
            approved: true,
            hasActiveWork: false,
          },
          matchingGroupUnitsByStatus: {
            unavailable: 0,
            backlog: 2,
            inProgress: 0,
            inReview: 0,
            completed: 10,
            error: 0,
          },
          operationalSignals: {
            completedWorkUnits: 12,
            abandonedWorkUnits: 2,
            erroredWorkUnits: 1,
            lastCompletedAt: "2026-08-29T18:00:00Z",
          },
        },
      ],
      hasMore: false,
      nextCursor: null,
    };
    const workforceBatchCoworkerActivity = {
      generatedAt: "2026-08-29T20:00:00Z",
      batchUid: "00000000000000000000000000000001",
      batchStatus: "available",
      staffingMode: "allocated",
      lineContext: {
        organizationUid: "00000000000000000000000000000002",
        projectUid: "00000000000000000000000000000003",
        datasetUid: "00000000000000000000000000000004",
        sequenceUid: "00000000000000000000000000000005",
      },
      activityWindow: {
        days: 14,
        startsAt: "2026-08-15T20:00:00.000Z",
      },
      coworkers: [
        {
          coworkerUid: "00000000000000000000000000000007",
          currentAllocation: true,
          readiness: {
            active: true,
            approved: true,
            hasActiveWork: true,
          },
          assignedUnitsByStatus: {
            unavailable: 0,
            backlog: 0,
            inProgress: 2,
            inReview: 1,
            completed: 10,
            error: 1,
          },
          activity: {
            submittedForReviewWorkUnits: 9,
            completedWorkUnits: 8,
            abandonedWorkUnits: 1,
            erroredWorkUnits: 1,
            lastActivityAt: "2026-08-29T18:00:00Z",
          },
        },
      ],
      hasMore: false,
      nextCursor: null,
    };
    const workforceBatchAllocationImpact = {
      generatedAt: "2026-08-29T20:00:00Z",
      operation: "add",
      batchUid: "00000000000000000000000000000001",
      coworkerUid: "00000000000000000000000000000007",
      batchStatus: "unavailable",
      staffingMode: "allocated",
      batchUpdatedAt: "2026-08-29T19:58:00Z",
      lineContext: {
        organizationUid: "00000000000000000000000000000002",
        projectUid: "00000000000000000000000000000003",
        datasetUid: "00000000000000000000000000000004",
        sequenceUid: "00000000000000000000000000000005",
      },
      currentAllocation: false,
      readiness: {
        active: true,
        approved: true,
        hasActiveWork: false,
      },
      matchingGroupUnitsByStatus: {
        unavailable: 0,
        backlog: 2,
        inProgress: 0,
        inReview: 0,
        completed: 10,
        error: 0,
      },
      effect: {
        scope: "batch",
        wouldChangeAllocation: true,
        qualifiedForBatchWork: true,
        currentEligibility: false,
        projectedEligibility: true,
        activeAssignedBatchWorkUnits: 0,
        removalBlockedByActiveBatchWork: false,
        eligibleAllocatedCoworkersAfterChange: 1,
        removalWouldLeaveAvailableBatchUnstaffed: false,
      },
    };
    const transport = {
      requestPage: vi.fn(
        async (path: string, query?: Record<string, string>) => {
          calls.push({ method: "GET", path, query });
          return {
            items: [path === "/exports/" ? exportItem : sampleEntity],
            nextCursor: null,
            previousCursor: null,
            hasMore: false,
          };
        },
      ),
      requestSingle: vi.fn(
        async (path: string, query?: Record<string, string>) => {
          calls.push({ method: "GET", path, query });
          if (path.endsWith("/annotation-issues/metrics/"))
            return annotationIssueMetrics;
          if (
            path.endsWith(
              "/results/00000000-0000-0000-0000-000000000019/acceptance/",
            )
          ) {
            return resultAcceptance;
          }
          if (path.endsWith("/acceptance/summary/")) return acceptanceSummary;
          if (path.endsWith("/acceptance/coverage/")) return acceptanceCoverage;
          if (path.endsWith("/capture-campaigns/")) return captureCampaigns;
          if (path.endsWith("/curation-preview/")) return curationPreview;
          if (path === "/admin/workforce/overview/")
            return workforceOperationsOverview;
          if (path === "/admin/workforce/batches/")
            return workforceBatchInventory;
          if (path === "/admin/workforce/groups/")
            return workforceGroupCatalog;
          if (
            path ===
            "/admin/workforce/groups/00000000000000000000000000000006/members/"
          )
            return workforceGroupMembers;
          if (
            path ===
            "/admin/workforce/groups/00000000000000000000000000000006/members/00000000000000000000000000000007/impact/"
          )
            return workforceGroupMembershipImpact;
          if (
            path ===
            "/admin/workforce/batches/00000000000000000000000000000001/attention/"
          )
            return workforceBatchAttention;
          if (
            path ===
            "/admin/workforce/batches/00000000000000000000000000000001/units/"
          )
            return workforceBatchUnits;
          if (
            path ===
            "/admin/workforce/work-units/00000000000000000000000000000006/assignment-candidates/"
          )
            return workforceAssignmentCandidates;
          if (
            path ===
            "/admin/workforce/batches/00000000000000000000000000000001/staffing-candidates/"
          )
            return workforceBatchStaffingCandidates;
          if (
            path ===
            "/admin/workforce/batches/00000000000000000000000000000001/coworker-activity/"
          )
            return workforceBatchCoworkerActivity;
          if (
            path ===
            "/admin/workforce/batches/00000000000000000000000000000001/coworkers/00000000000000000000000000000007/allocation-impact/"
          )
            return workforceBatchAllocationImpact;
          if (path.startsWith("/exports/")) return exportItem;
          return sampleEntity;
        },
      ),
      requestList: vi.fn(
        async (path: string, query?: Record<string, string>) => {
          calls.push({ method: "GET", path, query });
          if (path === "/qc-available-tools/") return [annotationIssueTool];
          if (path.includes("/annotation-issues/")) return [annotationIssue];
          return [sampleEntity];
        },
      ),
    };
    const server = {
      tool: vi.fn(),
      registerTool: vi.fn(
        (
          name: string,
          config: Record<string, unknown>,
          handler: ToolHandler,
        ) => {
          registrations.set(name, { config, handler });
        },
      ),
    };
    registerDatasetTools(
      server as never,
      (() => ({ transport })) as never,
      true,
    );
    registerSliceTools(server as never, (() => ({ transport })) as never);
    registerTaskTools(server as never, (() => ({ transport })) as never);
    registerOrganizationTools(
      server as never,
      (() => ({ transport })) as never,
    );
    registerAgentTools(server as never, (() => ({ transport })) as never);
    registerWebhookTools(server as never, (() => ({ transport })) as never);
    registerStorageTools(server as never, (() => ({ transport })) as never);
    registerQualityTools(server as never, (() => ({ transport })) as never);
    registerConsensusTools(server as never, (() => ({ transport })) as never);
    registerFleetTools(server as never, (() => ({ transport })) as never);
    registerAnnotationIssueTools(
      server as never,
      (() => ({ transport })) as never,
    );
    registerExportTools(server as never, (() => ({ transport })) as never);
    registerWorkforceTools(server as never, (() => ({ transport })) as never);

    for (const definition of READ_CATALOG_TOOLS) {
      const manifestRoute = routeManifest.find(
        (route) => route.name === definition.route.name,
      );
      if (monorepoAvailable) {
        expect(
          manifestRoute,
          `${definition.name} route is absent from the server manifest`,
        ).toBeDefined();
        expect(manifestRoute!.methods).toContain(
          definition.route.method.toLowerCase(),
        );

        const scopeDomain =
          manifestRoute!.scope_enforced_domain ??
          manifestRoute!.shadow_scope_domain;
        const expectedScopes = manifestRoute!.declares_scope?.length
          ? manifestRoute!.declares_scope!
          : scopeDomain
            ? [SCOPE_BY_DOMAIN[scopeDomain]]
            : [];
        expect(expectedScopes).toHaveLength(1);
        expect(definition.route.scope).toBe(expectedScopes[0]);
        const expectedToolset = expectedToolsetForRoute(
          manifestRoute!,
          scopeDomain,
        );
        expect(definition.route.toolset).toBe(expectedToolset);
      }

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
      expect(actualCall.path).toBe(
        renderCatalogPath(definition.route.path, SAMPLE_ARGS[definition.name]!),
      );
      expect(actualCall.query).toEqual(
        buildCatalogQuery(
          definition.route.query,
          SAMPLE_ARGS[definition.name]!,
          definition.route.fixedQuery,
        ),
      );
      if (manifestRoute) {
        expect(
          manifestPathPattern(manifestRoute.path).test(actualCall.path),
        ).toBe(true);
      }
      expect(result.structuredContent).toBeDefined();
      expect(JSON.parse(result.content[0]!.text)).toEqual(
        definition.route.response === "list"
          ? (result.structuredContent as { items: unknown[] }).items
          : result.structuredContent,
      );
    }
  });

  it.skipIf(!monorepoAvailable)(
    "pins every reviewed mutation to an idempotent enforcing route",
    () => {
      for (const definition of WORKFORCE_MUTATION_CATALOG_TOOLS) {
        const manifestRoute = routeManifest.find(
          (candidate) => candidate.name === definition.route.name,
        );
        expect(
          manifestRoute,
          `${definition.name} route is absent from the server manifest`,
        ).toBeDefined();
        expect(manifestRoute!.methods).toContain(
          definition.route.method.toLowerCase(),
        );
        expect(manifestRoute!.mcp_idempotent_mutation_methods).toContain(
          definition.route.method.toLowerCase(),
        );
        expect(manifestRoute!.declares_scope).toEqual([
          definition.route.scope,
        ]);
        expect(definition.route.scope).toMatch(/\.write$/);
        expect(definition.route.toolset).toBe("staff");
        expect(
          manifestPathPattern(manifestRoute!.path).test(
            renderCatalogPath(definition.route.path, {
              batchUid: "00000000000000000000000000000001",
              groupUid: "00000000000000000000000000000004",
              coworkerUid: "00000000000000000000000000000005",
              workUnitUid: "00000000000000000000000000000002",
              sequenceUid: "00000000000000000000000000000003",
            }),
          ),
        ).toBe(true);
      }
    },
  );

  it.skipIf(!monorepoAvailable)(
    "pins every composite dependency to the route manifest",
    () => {
      for (const definition of WORKFLOW_COMPOSITE_READ_CATALOG_TOOLS) {
        for (const route of definition.routes) {
          const manifestRoute = routeManifest.find(
            (candidate) => candidate.name === route.name,
          );
          expect(
            manifestRoute,
            `${definition.name} dependency ${route.name} is absent from the server manifest`,
          ).toBeDefined();
          expect(manifestRoute!.methods).toContain(route.method.toLowerCase());
          expect(
            manifestPathPattern(manifestRoute!.path).test(
              renderCatalogPath(route.path, {}),
            ),
          ).toBe(true);

          const scopeDomain =
            manifestRoute!.scope_enforced_domain ??
            manifestRoute!.shadow_scope_domain;
          expect(scopeDomain).toBeDefined();
          expect(route.scope).toBe(SCOPE_BY_DOMAIN[scopeDomain!]);
          expect(route.toolset).toBe(TOOLSET_BY_DOMAIN[scopeDomain!]);
        }
      }
    },
  );

  it("encodes one path segment and rejects values that could change routes", () => {
    expect(
      renderCatalogPath("/datasets/{owner}/{slug}/", {
        owner: "person@example.com",
        slug: "bag 1",
      }),
    ).toBe("/datasets/person%40example.com/bag%201/");
    expect(() =>
      renderCatalogPath("/datasets/{owner}/", { owner: "../admin" }),
    ).toThrow("not a valid URL path segment");
    expect(() => renderCatalogPath("/datasets/{owner}/", {})).toThrow(
      "must be a string or number",
    );
    expect(() =>
      renderCatalogPath("//attacker.example/{owner}/", { owner: "safe" }),
    ).toThrow("must be an absolute, trailing-slash API path");
    expect(() => renderCatalogPath("/datasets/{not-valid}/", {})).toThrow(
      "contains an invalid placeholder",
    );
  });

  it("maps only present primitive query arguments", () => {
    expect(
      buildCatalogQuery(
        { dataType: "data_type", limit: "limit", cursor: "cursor" },
        { dataType: "mcap", limit: 25, cursor: undefined },
      ),
    ).toEqual({ data_type: "mcap", limit: "25" });
    expect(
      buildCatalogQuery(
        { limit: "limit" },
        { limit: 500 },
        { limit: "100", status: "open" },
      ),
    ).toEqual({
      limit: "100",
      status: "open",
    });
  });

  it("wraps bare REST lists for structured content while preserving text compatibility", async () => {
    const itemSchema = z.object({ uid: z.string(), name: z.string() }).strip();
    const definition = defineReadCatalogTool({
      name: "list_example_items",
      title: "List example items",
      description: "List example items.",
      inputSchema: z.object({ kind: z.string().optional() }),
      outputSchema: defineListOutputSchema(itemSchema),
      route: {
        name: "example-items",
        method: "GET",
        path: "/example-items/",
        query: { kind: "kind" },
        response: "list",
        scope: "datasets.read",
        toolset: "datasets",
      },
    });
    const requestList = vi.fn(async () => [
      { uid: "item-1", name: "Example", unexpected: "must be stripped" },
    ]);
    let handler: ToolHandler | undefined;
    const server = {
      registerTool: vi.fn(
        (_name: string, _config: unknown, callback: ToolHandler) => {
          handler = callback;
        },
      ),
    };

    registerReadCatalogTool(
      server as never,
      (() => ({ transport: { requestList } })) as never,
      definition,
    );
    const result = await handler!({ kind: "camera" });

    expect(requestList).toHaveBeenCalledWith("/example-items/", {
      kind: "camera",
    });
    expect(result.structuredContent).toEqual({
      items: [{ uid: "item-1", name: "Example" }],
    });
    expect(JSON.parse(result.content[0]!.text)).toEqual([
      { uid: "item-1", name: "Example" },
    ]);
  });

  it("redacts sensitive REST fields from text and structured content", async () => {
    const definition = defineReadCatalogTool({
      name: "get_example_item",
      title: "Get example item",
      description: "Get one example item.",
      inputSchema: z.object({}),
      outputSchema: z
        .object({
          uid: z.string(),
          metadata: z.record(z.string(), z.unknown()),
        })
        .passthrough(),
      route: {
        name: "example-item",
        method: "GET",
        path: "/example-item/",
        response: "single",
        scope: "datasets.read",
        toolset: "datasets",
      },
    });
    const requestSingle = vi.fn(async () => ({
      uid: "item-1",
      token: "top-level-token",
      metadata: {
        api_key: "nested-api-key",
        s3_secret_access_key: "nested-s3-secret",
        stripe_secret_key: "nested-stripe-secret",
        auth_token: "nested-auth-token",
        api_token: "nested-api-token",
        gc_storage_auth_json_content: "nested-storage-auth-json",
        auth_header: "nested-auth-header",
        aws_access_key: "nested-aws-access-key",
        workerJwt: "nested-worker-jwt",
        nested: [{ Authorization: "Bearer nested-token" }],
        secret: null,
      },
    }));
    let handler: ToolHandler | undefined;
    const server = {
      registerTool: vi.fn(
        (_name: string, _config: unknown, callback: ToolHandler) => {
          handler = callback;
        },
      ),
    };

    registerReadCatalogTool(
      server as never,
      (() => ({ transport: { requestSingle } })) as never,
      definition,
    );
    const result = await handler!({});

    expect(result.structuredContent).toEqual({
      uid: "item-1",
      token: "[redacted]",
      metadata: {
        api_key: "[redacted]",
        s3_secret_access_key: "[redacted]",
        stripe_secret_key: "[redacted]",
        auth_token: "[redacted]",
        api_token: "[redacted]",
        gc_storage_auth_json_content: "[redacted]",
        auth_header: "[redacted]",
        aws_access_key: "[redacted]",
        workerJwt: "[redacted]",
        nested: [{ Authorization: "[redacted]" }],
        secret: null,
      },
    });
    expect(JSON.parse(result.content[0]!.text)).toEqual(
      result.structuredContent,
    );
    expect(result.content[0]!.text).not.toContain("top-level-token");
    expect(result.content[0]!.text).not.toContain("nested-api-key");
    expect(result.content[0]!.text).not.toContain("nested-s3-secret");
    expect(result.content[0]!.text).not.toContain("nested-stripe-secret");
    expect(result.content[0]!.text).not.toContain("nested-auth-token");
    expect(result.content[0]!.text).not.toContain("nested-api-token");
    expect(result.content[0]!.text).not.toContain("nested-storage-auth-json");
    expect(result.content[0]!.text).not.toContain("nested-auth-header");
    expect(result.content[0]!.text).not.toContain("nested-aws-access-key");
    expect(result.content[0]!.text).not.toContain("nested-worker-jwt");
    expect(result.content[0]!.text).not.toContain("nested-token");
  });

  it("forwards declared query arguments to single-object reads", async () => {
    const definition = defineReadCatalogTool({
      name: "get_example_metrics",
      title: "Get example metrics",
      description: "Get filtered example metrics.",
      inputSchema: z.object({ sequenceUid: z.string().optional() }),
      outputSchema: z.object({ total: z.number() }).strip(),
      route: {
        name: "example-metrics",
        method: "GET",
        path: "/example-metrics/",
        query: { sequenceUid: "sequence_uid" },
        response: "single",
        scope: "qc.read",
        toolset: "quality",
      },
    });
    const requestSingle = vi.fn(async () => ({ total: 3 }));
    let handler: ToolHandler | undefined;
    const server = {
      registerTool: vi.fn(
        (_name: string, _config: unknown, callback: ToolHandler) => {
          handler = callback;
        },
      ),
    };

    registerReadCatalogTool(
      server as never,
      (() => ({ transport: { requestSingle } })) as never,
      definition,
    );
    const result = await handler!({ sequenceUid: "seq-001" });

    expect(requestSingle).toHaveBeenCalledWith("/example-metrics/", {
      sequence_uid: "seq-001",
    });
    expect(result.structuredContent).toEqual({ total: 3 });
    expect(JSON.parse(result.content[0]!.text)).toEqual({ total: 3 });
  });

  it("executes composite reads only through declared routes", async () => {
    const definition = defineCompositeReadCatalogTool({
      name: "get_example_health",
      title: "Get example health",
      description: "Combine device and alert health.",
      inputSchema: z.object({
        type: z.string().optional(),
        useUnknown: z.boolean().optional(),
      }),
      outputSchema: z
        .object({ deviceCount: z.number(), alertCount: z.number() })
        .passthrough(),
      routes: [
        {
          name: "example-device-list",
          method: "GET",
          path: "/example-devices/",
          query: { type: "type" },
          fixedQuery: { limit: "100" },
          response: "page",
          scope: "fleet.read",
          toolset: "fleet",
        },
        {
          name: "example-alert-list",
          method: "GET",
          path: "/example-alerts/",
          fixedQuery: { status: "open" },
          response: "list",
          scope: "fleet.read",
          toolset: "fleet",
        },
      ],
      execute: async (args, read) => {
        if (args.useUnknown) return read("undeclared-route");
        const [devicePage, alerts] = await Promise.all([
          read("example-device-list") as Promise<{ items: unknown[] }>,
          read("example-alert-list") as Promise<unknown[]>,
        ]);
        return {
          deviceCount: devicePage.items.length,
          alertCount: alerts.length,
          details: { clientSecret: "composite-secret" },
        };
      },
    });
    const transport = {
      requestPage: vi.fn(async () => ({
        items: [{ uid: "device-1" }],
        hasMore: false,
      })),
      requestList: vi.fn(async () => [{ uid: "alert-1" }, { uid: "alert-2" }]),
    };
    const getClient = vi.fn(() => ({ transport }));
    let handler: ToolHandler | undefined;
    let config: Record<string, unknown> | undefined;
    const server = {
      registerTool: vi.fn(
        (
          _name: string,
          toolConfig: Record<string, unknown>,
          callback: ToolHandler,
        ) => {
          config = toolConfig;
          handler = callback;
        },
      ),
    };

    registerCompositeReadCatalogTool(
      server as never,
      getClient as never,
      definition,
    );
    const result = await handler!({ type: "camera" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(transport.requestPage).toHaveBeenCalledWith("/example-devices/", {
      limit: "100",
      type: "camera",
    });
    expect(transport.requestList).toHaveBeenCalledWith("/example-alerts/", {
      status: "open",
    });
    expect(result.structuredContent).toEqual({
      deviceCount: 1,
      alertCount: 2,
      details: { clientSecret: "[redacted]" },
    });
    expect(JSON.parse(result.content[0]!.text)).toEqual(
      result.structuredContent,
    );
    expect(result.content[0]!.text).not.toContain("composite-secret");
    expect(config!._meta).toEqual({
      "avala.ai/rest-routes": ["example-device-list", "example-alert-list"],
      "avala.ai/rest-methods": ["GET", "GET"],
      "avala.ai/required-scopes": ["fleet.read"],
      "avala.ai/toolsets": ["fleet"],
      "avala.ai/required-scope": "fleet.read",
      "avala.ai/toolset": "fleet",
    });
    await expect(handler!({ useUnknown: true })).rejects.toThrow(
      "tried to read undeclared route 'undeclared-route'",
    );
  });
});
