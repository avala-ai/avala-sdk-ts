import type { CursorPage, InferenceProvider } from "../types.js";
import { BaseResource } from "./base.js";

export interface CreateInferenceProviderOptions {
  name: string;
  description?: string;
  providerType: string;
  config: Record<string, unknown>;
  project?: string;
}

export interface UpdateInferenceProviderOptions {
  name?: string;
  description?: string;
  providerType?: string;
  config?: Record<string, unknown>;
  isActive?: boolean;
  project?: string;
}

export class InferenceProvidersResource extends BaseResource {
  async list(options?: { limit?: number; cursor?: string }): Promise<CursorPage<InferenceProvider>> {
    const params: Record<string, string> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<InferenceProvider>("/inference-providers/", Object.keys(params).length > 0 ? params : undefined);
  }

  async create(options: CreateInferenceProviderOptions): Promise<InferenceProvider> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      name: "name",
      description: "description",
      providerType: "provider_type",
      config: "config",
      project: "project",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    return this.http.requestCreate<InferenceProvider>("/inference-providers/", payload);
  }

  async get(uid: string): Promise<InferenceProvider> {
    return this.http.requestSingle<InferenceProvider>(`/inference-providers/${uid}/`);
  }

  async update(uid: string, options: UpdateInferenceProviderOptions): Promise<InferenceProvider> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      name: "name",
      description: "description",
      providerType: "provider_type",
      config: "config",
      isActive: "is_active",
      project: "project",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    const raw = await this.http.request<Record<string, unknown>>("PATCH", `/inference-providers/${uid}/`, { json: payload });
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      result[camelKey] = value;
    }
    return result as unknown as InferenceProvider;
  }

  async delete(uid: string): Promise<void> {
    await this.http.request("DELETE", `/inference-providers/${uid}/`);
  }

  async test(uid: string): Promise<{ success: boolean; message: string; testedAt: string }> {
    const raw = await this.http.request<Record<string, unknown>>("POST", `/inference-providers/${uid}/test/`);
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      result[camelKey] = value;
    }
    return result as unknown as { success: boolean; message: string; testedAt: string };
  }
}
