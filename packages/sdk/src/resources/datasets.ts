import type { CursorPage, Dataset, DatasetItem, DatasetSequence } from "../types.js";
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

  async listItems(
    owner: string,
    slug: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<CursorPage<DatasetItem>> {
    const params: Record<string, string> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<DatasetItem>(
      `/datasets/${owner}/${slug}/items/`,
      Object.keys(params).length > 0 ? params : undefined,
    );
  }

  async getItem(owner: string, slug: string, itemUid: string): Promise<DatasetItem> {
    return this.http.requestSingle<DatasetItem>(`/datasets/${owner}/${slug}/items/${itemUid}/`);
  }

  async listSequences(
    owner: string,
    slug: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<CursorPage<DatasetSequence>> {
    const params: Record<string, string> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<DatasetSequence>(
      `/datasets/${owner}/${slug}/sequences/`,
      Object.keys(params).length > 0 ? params : undefined,
    );
  }

  async getSequence(owner: string, slug: string, sequenceUid: string): Promise<DatasetSequence> {
    return this.http.requestSingle<DatasetSequence>(`/datasets/${owner}/${slug}/sequences/${sequenceUid}/`);
  }
}
