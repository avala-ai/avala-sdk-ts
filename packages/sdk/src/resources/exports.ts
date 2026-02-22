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
    const raw = await this.http.request<Record<string, unknown>>("POST", "/exports/", { json: options });
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      result[camelKey] = value;
    }
    return result as unknown as Export;
  }

  async get(uid: string): Promise<Export> {
    return this.http.requestSingle<Export>(`/exports/${uid}/`);
  }
}
