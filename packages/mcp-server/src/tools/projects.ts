import type { McpServer } from "@modelcontextprotocol/server";
import type { GetClient } from "../client.js";
import { z } from "zod";
import {
  DEFAULT_PAGE_LIMIT,
  detailInputField,
  presentReadDetail,
  withPaginationAliases,
} from "../readDetail.js";

const PROJECT_CONCISE_KEYS = [
  "uid",
  "name",
  "slug",
  "status",
  "owner",
  "ownerName",
  "updatedAt",
] as const;

export function registerProjectTools(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "list_projects",
    {
      description:
        "List the annotation projects this credential can see, with status and progress. Reads the caller's own project scope via /users/me/projects/; it does NOT list every project on the instance, which is a staff-only surface. Default detail is concise (uid, name, status, owner, updatedAt). Use detail=full for configuration blobs. Pagination uses the upstream cursor when the SDK page provides one.",
      inputSchema: z.object({
        limit: z
          .number()
          .optional()
          .describe(
            "Maximum number of projects to return. Defaults to 25 when omitted.",
          ),
        cursor: z
          .string()
          .optional()
          .describe("Pagination cursor from a previous request"),
        detail: detailInputField,
      }),
      _meta: {
        "avala.ai/required-scope": "projects.read",
        "avala.ai/toolset": "projects",
      },
    },
    async ({ limit, cursor, detail }) => {
      const avala = getClient("list_projects");
      const page = await avala.projects.listMine({
        limit: limit ?? DEFAULT_PAGE_LIMIT,
        cursor,
      });
      const presented = presentReadDetail(
        withPaginationAliases(page as unknown as Record<string, unknown>),
        { detail },
        PROJECT_CONCISE_KEYS,
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(presented, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_project",
    {
      description:
        "Get one of the caller's own projects. Default detail is identity and status. Use detail=full for configuration and current progress. Staff listing of every project on the instance is a different surface.",
      inputSchema: z.object({
        uid: z.string().describe("The unique identifier (UUID) of the project"),
        detail: detailInputField,
      }),
      _meta: {
        "avala.ai/required-scope": "projects.read",
        "avala.ai/toolset": "projects",
      },
    },
    async ({ uid, detail }) => {
      const avala = getClient("get_project");
      const project = await avala.projects.getMine(uid);
      const presented = presentReadDetail(
        project,
        { detail },
        PROJECT_CONCISE_KEYS,
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(presented, null, 2),
          },
        ],
      };
    },
  );
}
