import type { CursorPage, Task } from "../types.js";
import { BaseResource } from "./base.js";

export class TasksResource extends BaseResource {
  async list(options?: {
    project?: string;
    status?: string;
    limit?: number;
    cursor?: string;
  }): Promise<CursorPage<Task>> {
    const params: Record<string, string> = {};
    if (options?.project) params.project = options.project;
    if (options?.status) params.status = options.status;
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<Task>("/tasks/", Object.keys(params).length > 0 ? params : undefined);
  }

  async get(uid: string): Promise<Task> {
    return this.http.requestSingle<Task>(`/tasks/${uid}/`);
  }
}
