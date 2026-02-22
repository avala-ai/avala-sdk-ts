import type { CursorPage, Project } from "../types.js";
import { BaseResource } from "./base.js";

export class ProjectsResource extends BaseResource {
  async list(options?: { limit?: number; cursor?: string }): Promise<CursorPage<Project>> {
    const params: Record<string, string> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<Project>("/projects/", Object.keys(params).length > 0 ? params : undefined);
  }

  async get(uid: string): Promise<Project> {
    return this.http.requestSingle<Project>(`/projects/${uid}/`);
  }
}
