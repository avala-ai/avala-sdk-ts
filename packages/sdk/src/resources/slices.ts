import type { CursorPage, Slice, SliceItem } from "../types.js";
import { BaseResource } from "./base.js";

export interface CreateSliceOptions {
  name: string;
  visibility: string;
  subSlices: Array<Record<string, unknown>>;
  organization?: string;
  randomSelectionCount?: number;
}

export class SlicesResource extends BaseResource {
  async list(owner: string, options?: { limit?: number; cursor?: string }): Promise<CursorPage<Slice>> {
    const params: Record<string, string> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<Slice>(
      `/slices/${owner}/list/`,
      Object.keys(params).length > 0 ? params : undefined,
    );
  }

  async get(owner: string, slug: string): Promise<Slice> {
    return this.http.requestSingle<Slice>(`/slices/${owner}/${slug}/`);
  }

  async create(options: CreateSliceOptions): Promise<Slice> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      name: "name",
      visibility: "visibility",
      subSlices: "sub_slices",
      organization: "organization",
      randomSelectionCount: "random_selection_count",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    return this.http.requestCreate<Slice>("/slices/", payload);
  }

  async listItems(
    owner: string,
    slug: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<CursorPage<SliceItem>> {
    const params: Record<string, string> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<SliceItem>(
      `/slices/${owner}/${slug}/items/list/`,
      Object.keys(params).length > 0 ? params : undefined,
    );
  }

  async getItem(owner: string, slug: string, itemUid: string): Promise<SliceItem> {
    return this.http.requestSingle<SliceItem>(`/slices/${owner}/${slug}/items/${itemUid}/`);
  }
}
