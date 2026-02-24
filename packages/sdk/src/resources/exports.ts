import type { CursorPage, Export } from "../types.js";
import { BaseResource } from "./base.js";

export class ExportsResource extends BaseResource {
  async list(options?: { limit?: number; cursor?: string }): Promise<CursorPage<Export>> {
    const params: Record<string, string> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<Export>("/exports/", Object.keys(params).length > 0 ? params : undefined);
  }

  async create(options: { project?: string; dataset?: string }): Promise<Export> {
    return this.http.requestCreate<Export>("/exports/", options);
  }

  async get(uid: string): Promise<Export> {
    return this.http.requestSingle<Export>(`/exports/${uid}/`);
  }
}
