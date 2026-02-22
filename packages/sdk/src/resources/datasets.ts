import type { CursorPage, Dataset } from "../types.js";
import { BaseResource } from "./base.js";

export class DatasetsResource extends BaseResource {
  async list(options?: { limit?: number; cursor?: string }): Promise<CursorPage<Dataset>> {
    const params: Record<string, string> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<Dataset>("/datasets/", Object.keys(params).length > 0 ? params : undefined);
  }

  async get(uid: string): Promise<Dataset> {
    return this.http.requestSingle<Dataset>(`/datasets/${uid}/`);
  }
}
