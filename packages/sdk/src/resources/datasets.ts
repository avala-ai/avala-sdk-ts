import type { CursorPage, Dataset, DatasetItem, DatasetSequence } from "../types.js";
import { BaseResource } from "./base.js";

export interface CreateDatasetOptions {
  name: string;
  slug: string;
  dataType: string;
  isSequence?: boolean;
  visibility?: string;
  createMetadata?: boolean;
  providerConfig?: Record<string, unknown>;
  ownerName?: string;
}

export class DatasetsResource extends BaseResource {
  async create(options: CreateDatasetOptions): Promise<Dataset> {
    const payload: Record<string, unknown> = {
      name: options.name,
      slug: options.slug,
      data_type: options.dataType,
    };
    if (options.isSequence !== undefined) payload.is_sequence = options.isSequence;
    if (options.visibility !== undefined) payload.visibility = options.visibility;
    if (options.createMetadata !== undefined) payload.create_metadata = options.createMetadata;
    if (options.providerConfig !== undefined) payload.provider_config = options.providerConfig;
    if (options.ownerName !== undefined) payload.owner_name = options.ownerName;
    return this.http.requestCreate<Dataset>("/datasets/", payload);
  }

  async list(options?: {
    dataType?: string;
    name?: string;
    status?: string;
    visibility?: string;
    limit?: number;
    cursor?: string;
  }): Promise<CursorPage<Dataset>> {
    const params: Record<string, string> = {};
    if (options?.dataType !== undefined) params.data_type = options.dataType;
    if (options?.name !== undefined) params.name = options.name;
    if (options?.status !== undefined) params.status = options.status;
    if (options?.visibility !== undefined) params.visibility = options.visibility;
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor !== undefined) params.cursor = options.cursor;
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
    if (options?.cursor !== undefined) params.cursor = options.cursor;
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
    if (options?.cursor !== undefined) params.cursor = options.cursor;
    return this.http.requestPage<DatasetSequence>(
      `/datasets/${owner}/${slug}/sequences/`,
      Object.keys(params).length > 0 ? params : undefined,
    );
  }

  async getSequence(owner: string, slug: string, sequenceUid: string): Promise<DatasetSequence> {
    return this.http.requestSingle<DatasetSequence>(`/datasets/${owner}/${slug}/sequences/${sequenceUid}/`);
  }
}
