import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Avala } from "@avala-ai/sdk";
import { z } from "zod";

export function registerAnnotationIssueTools(server: McpServer, avala: Avala, allowMutations = false): void {
  server.tool(
    "list_annotation_issues_by_sequence",
    "List annotation issues for a specific sequence.",
    {
      sequenceUid: z.string().describe("The UID of the sequence"),
      datasetItemUid: z.string().optional().describe("Filter by dataset item UID"),
      projectUid: z.string().optional().describe("Filter by project UID"),
    },
    async ({ sequenceUid, datasetItemUid, projectUid }) => {
      const result = await avala.annotationIssues.listBySequence(sequenceUid, {
        datasetItemUid,
        projectUid,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

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
        await avala.annotationIssues.delete(sequenceUid, issueUid);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: true }, null, 2) }],
        };
      },
    );
  }

  server.tool(
    "list_annotation_issues_by_dataset",
    "List annotation issues for a specific dataset.",
    {
      owner: z.string().describe("The dataset owner"),
      datasetSlug: z.string().describe("The dataset slug"),
      sequenceUid: z.string().optional().describe("Filter by sequence UID"),
    },
    async ({ owner, datasetSlug, sequenceUid }) => {
      const result = await avala.annotationIssues.listByDataset(owner, datasetSlug, {
        sequenceUid,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "get_annotation_issue_metrics",
    "Get annotation issue metrics for a dataset.",
    {
      owner: z.string().describe("The dataset owner"),
      datasetSlug: z.string().describe("The dataset slug"),
      sequenceUid: z.string().optional().describe("Filter by sequence UID"),
    },
    async ({ owner, datasetSlug, sequenceUid }) => {
      const result = await avala.annotationIssues.getMetrics(owner, datasetSlug, {
        sequenceUid,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "list_qc_tools",
    "List available QC annotation tools for a dataset type.",
    {
      datasetType: z.string().describe("The dataset type (e.g. 'image', 'video', 'lidar')"),
    },
    async ({ datasetType }) => {
      const result = await avala.annotationIssues.listTools({ datasetType });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
