import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetClient } from "../client.js";
import { defineListOutputSchema, defineReadCatalogTool, registerReadCatalogTool } from "../catalog.js";
import { sanitizeForOutput } from "../redact.js";
import { z } from "zod";

const sanitizedRecordSchema = z.record(z.unknown()).transform(
  (value): Record<string, unknown> => sanitizeForOutput(value) as Record<string, unknown>,
);

const annotationIssueProblemOutputSchema = z
  .object({
    uid: z.string(),
    title: z.string(),
  })
  .strip();

const annotationIssueOutputSchema = z
  .object({
    uid: z.string(),
    datasetItemUid: z.string().nullable(),
    sequenceUid: z.string().nullable(),
    project: z
      .object({
        uid: z.string(),
        name: z.string(),
      })
      .strip()
      .nullable(),
    reporter: z
      .object({
        username: z.string(),
        picture: z.string().nullable(),
        fullName: z.string().nullable(),
        type: z.string().nullable(),
        isStaff: z.boolean().nullable(),
      })
      .strip()
      .nullable(),
    priority: z.string().nullable(),
    severity: z.string().nullable(),
    description: z.string().nullable(),
    status: z.string().nullable(),
    tool: z
      .object({
        uid: z.string(),
        name: z.string(),
        default: z.boolean().nullable(),
      })
      .strip()
      .nullable(),
    problem: annotationIssueProblemOutputSchema.nullable(),
    wrongClass: z.string().nullable(),
    correctClass: z.string().nullable(),
    shouldReAnnotate: z.boolean().nullable(),
    shouldDelete: z.boolean().nullable(),
    framesAffected: z.string().nullable(),
    coordinates: z.union([sanitizedRecordSchema, z.array(sanitizedRecordSchema)]).nullable(),
    queryParams: sanitizedRecordSchema.nullable(),
    createdAt: z.string().nullable(),
    closedAt: z.string().nullable(),
    objectUid: z.string().nullable(),
  })
  .strip();

const annotationIssueToolOutputSchema = z
  .object({
    uid: z.string(),
    name: z.string(),
    datasetType: z.string().nullable(),
    default: z.boolean().nullable(),
    problems: z.array(annotationIssueProblemOutputSchema).nullable(),
  })
  .strip();

const annotationIssueMetricsOutputSchema = z
  .object({
    statusCount: z.record(z.number()).nullable(),
    priorityCount: z.record(z.number()).nullable(),
    severityCount: z.record(z.number()).nullable(),
    meanSecondsCloseTimeAll: z.number().nullable(),
    meanSecondsCloseTimeCustomer: z.number().nullable(),
    meanUnresolvedIssueAgeAll: z.number().nullable(),
    meanUnresolvedIssueAgeCustomer: z.number().nullable(),
    objectCountByAnnotationIssueProblemUid: z.array(sanitizedRecordSchema).nullable(),
  })
  .strip();

const listAnnotationIssuesBySequenceTool = defineReadCatalogTool({
  name: "list_annotation_issues_by_sequence",
  title: "List annotation issues by sequence",
  description: "List annotation issues for a specific sequence.",
  inputSchema: z.object({
    sequenceUid: z.string().describe("The UID of the sequence"),
    datasetItemUid: z.string().optional().describe("Filter by dataset item UID"),
    projectUid: z.string().optional().describe("Filter by project UID"),
  }),
  outputSchema: defineListOutputSchema(annotationIssueOutputSchema),
  route: {
    name: "sequence-annotation-issues",
    method: "GET",
    path: "/sequences/{sequenceUid}/annotation-issues/",
    query: { datasetItemUid: "dataset_item_uid", projectUid: "project_uid" },
    response: "list",
    scope: "qc.read",
    toolset: "quality",
  },
});

const listAnnotationIssuesByDatasetTool = defineReadCatalogTool({
  name: "list_annotation_issues_by_dataset",
  title: "List annotation issues by dataset",
  description: "List annotation issues for a specific dataset.",
  inputSchema: z.object({
    owner: z.string().describe("The dataset owner"),
    datasetSlug: z.string().describe("The dataset slug"),
    sequenceUid: z.string().optional().describe("Filter by sequence UID"),
  }),
  outputSchema: defineListOutputSchema(annotationIssueOutputSchema),
  route: {
    name: "dataset-issues",
    method: "GET",
    path: "/datasets/{owner}/{datasetSlug}/annotation-issues/",
    query: { sequenceUid: "sequence_uid" },
    response: "list",
    scope: "qc.read",
    toolset: "quality",
  },
});

const listQcToolsTool = defineReadCatalogTool({
  name: "list_qc_tools",
  title: "List QC tools",
  description: "List available QC annotation tools for a dataset type.",
  inputSchema: z.object({
    datasetType: z.string().describe("The dataset type (e.g. 'image', 'video', 'lidar')"),
  }),
  outputSchema: defineListOutputSchema(annotationIssueToolOutputSchema),
  route: {
    name: "qc-available-tools",
    method: "GET",
    path: "/qc-available-tools/",
    query: { datasetType: "dataset_type" },
    response: "list",
    scope: "qc.read",
    toolset: "quality",
  },
});

const getAnnotationIssueMetricsTool = defineReadCatalogTool({
  name: "get_annotation_issue_metrics",
  title: "Get annotation issue metrics",
  description: "Get annotation issue metrics for a dataset.",
  inputSchema: z.object({
    owner: z.string().describe("The dataset owner"),
    datasetSlug: z.string().describe("The dataset slug"),
    sequenceUid: z.string().optional().describe("Filter by sequence UID"),
  }),
  outputSchema: annotationIssueMetricsOutputSchema,
  route: {
    name: "dataset-issue-metrics",
    method: "GET",
    path: "/datasets/{owner}/{datasetSlug}/annotation-issues/metrics/",
    query: { sequenceUid: "sequence_uid" },
    response: "single",
    scope: "qc.read",
    toolset: "quality",
  },
});

export const ANNOTATION_ISSUE_READ_CATALOG_TOOLS = [
  listAnnotationIssuesBySequenceTool,
  listAnnotationIssuesByDatasetTool,
  getAnnotationIssueMetricsTool,
  listQcToolsTool,
] as const;

export function registerAnnotationIssueTools(server: McpServer, getClient: GetClient, allowMutations = false): void {
  registerReadCatalogTool(server, getClient, listAnnotationIssuesBySequenceTool);

  if (allowMutations) {
    server.tool(
      "create_annotation_issue",
      "Create a new annotation issue on a sequence.",
      {
        sequenceUid: z.string().describe("The UID of the sequence"),
        toolUid: z.string().describe("The UID of the annotation tool"),
        problemUid: z.string().describe("The UID of the annotation issue problem"),
        datasetItemUid: z.string().optional().describe("The UID of the dataset item"),
        projectUid: z.string().optional().describe("The UID of the project"),
        priority: z.enum(["lowest", "low", "medium", "high", "highest"]).optional().describe("Issue priority"),
        severity: z.enum(["critical", "moderate"]).optional().describe("Issue severity"),
        description: z.string().optional().describe("Description of the issue"),
        wrongClass: z.string().optional().describe("The incorrect class label"),
        correctClass: z.string().optional().describe("The correct class label"),
        shouldReAnnotate: z.boolean().optional().describe("Whether to re-annotate"),
        shouldDelete: z.boolean().optional().describe("Whether to delete the annotation"),
        framesAffected: z.string().optional().describe("Frames affected by the issue"),
        coordinates: z.unknown().optional().describe("Coordinates of the issue"),
        queryParams: z.record(z.unknown()).optional().describe("Additional query parameters"),
        objectUid: z.string().optional().describe("The UID of the annotation object"),
      },
      async ({ sequenceUid, ...options }) => {
        const avala = getClient("create_annotation_issue");
        const result = await avala.annotationIssues.create(sequenceUid, options);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      },
    );

    server.tool(
      "update_annotation_issue",
      "Update an existing annotation issue.",
      {
        sequenceUid: z.string().describe("The UID of the sequence"),
        issueUid: z.string().describe("The UID of the annotation issue"),
        status: z
          .enum(["open", "relabeling", "in_review", "completed", "cant_reproduce", "awaiting_feedback", "no_action_taken"])
          .optional()
          .describe("Issue status"),
        priority: z.enum(["lowest", "low", "medium", "high", "highest"]).optional().describe("Issue priority"),
        severity: z.enum(["critical", "moderate"]).optional().describe("Issue severity"),
        description: z.string().optional().describe("Description of the issue"),
        toolUid: z.string().optional().describe("The UID of the annotation tool"),
        problemUid: z.string().optional().describe("The UID of the annotation issue problem"),
        wrongClass: z.string().optional().describe("The incorrect class label"),
        framesAffected: z.string().optional().describe("Frames affected by the issue"),
      },
      async ({ sequenceUid, issueUid, ...options }) => {
        const avala = getClient("update_annotation_issue");
        const result = await avala.annotationIssues.update(sequenceUid, issueUid, options);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      },
    );

    server.tool(
      "delete_annotation_issue",
      "Delete an annotation issue.",
      {
        sequenceUid: z.string().describe("The UID of the sequence"),
        issueUid: z.string().describe("The UID of the annotation issue"),
      },
      async ({ sequenceUid, issueUid }) => {
        const avala = getClient("delete_annotation_issue");
        await avala.annotationIssues.delete(sequenceUid, issueUid);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: true }, null, 2) }],
        };
      },
    );
  }

  registerReadCatalogTool(server, getClient, listAnnotationIssuesByDatasetTool);

  registerReadCatalogTool(server, getClient, getAnnotationIssueMetricsTool);

  registerReadCatalogTool(server, getClient, listQcToolsTool);
}
