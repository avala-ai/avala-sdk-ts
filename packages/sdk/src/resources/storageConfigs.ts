import type { CursorPage, StorageConfig } from "../types.js";
import { BaseResource } from "./base.js";

export interface CreateStorageConfigOptions {
  name: string;
  provider: string;
  s3BucketName?: string;
  s3BucketRegion?: string;
  s3BucketPrefix?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3IsAccelerated?: boolean;
  gcStorageBucketName?: string;
  gcStoragePrefix?: string;
  gcStorageAuthJsonContent?: string;
}

export class StorageConfigsResource extends BaseResource {
  async list(options?: { limit?: number; cursor?: string }): Promise<CursorPage<StorageConfig>> {
    const params: Record<string, string> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<StorageConfig>(
      "/storage-configs/",
      Object.keys(params).length > 0 ? params : undefined,
    );
  }

  async create(options: CreateStorageConfigOptions): Promise<StorageConfig> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      name: "name",
      provider: "provider",
      s3BucketName: "s3_bucket_name",
      s3BucketRegion: "s3_bucket_region",
      s3BucketPrefix: "s3_bucket_prefix",
      s3AccessKeyId: "s3_access_key_id",
      s3SecretAccessKey: "s3_secret_access_key",
      s3IsAccelerated: "s3_is_accelerated",
      gcStorageBucketName: "gc_storage_bucket_name",
      gcStoragePrefix: "gc_storage_prefix",
      gcStorageAuthJsonContent: "gc_storage_auth_json_content",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    const raw = await this.http.request<Record<string, unknown>>("POST", "/storage-configs/", { json: payload });
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      result[camelKey] = value;
    }
    return result as unknown as StorageConfig;
  }

  async test(uid: string): Promise<{ verified: boolean; errors?: Record<string, string[]> }> {
    return this.http.request("POST", `/storage-configs/${uid}/test/`);
  }

  async delete(uid: string): Promise<void> {
    await this.http.request("DELETE", `/storage-configs/${uid}/`);
  }
}
