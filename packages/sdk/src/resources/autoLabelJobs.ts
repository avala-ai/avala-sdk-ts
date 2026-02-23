import type { AutoLabelJob, CursorPage } from "../types.js";
import { BaseResource } from "./base.js";

export interface CreateAutoLabelJobOptions {
  modelType?: string;
  confidenceThreshold?: number;
  labels?: string[];
  dryRun?: boolean;
}

export class AutoLabelJobsResource extends BaseResource {
  async list(options?: { project?: string; status?: string; limit?: number; cursor?: string }): Promise<CursorPage<AutoLabelJob>> {
    const params: Record<string, string> = {};
    if (options?.project) params.project = options.project;
    if (options?.status) params.status = options.status;
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<AutoLabelJob>("/auto-label-jobs/", Object.keys(params).length > 0 ? params : undefined);
  }

  async get(uid: string): Promise<AutoLabelJob> {
    return this.http.requestSingle<AutoLabelJob>(`/auto-label-jobs/${uid}/`);
  }

  async create(projectUid: string, options?: CreateAutoLabelJobOptions): Promise<AutoLabelJob> {
    const payload: Record<string, unknown> = {};
    if (options?.modelType !== undefined) payload.model_type = options.modelType;
    if (options?.confidenceThreshold !== undefined) payload.confidence_threshold = options.confidenceThreshold;
    if (options?.labels !== undefined) payload.labels = options.labels;
    if (options?.dryRun !== undefined) payload.dry_run = options.dryRun;
    return this.http.requestCreate<AutoLabelJob>(`/projects/${projectUid}/auto-label/`, payload);
  }

  async cancel(uid: string): Promise<void> {
    await this.http.request("DELETE", `/auto-label-jobs/${uid}/`);
  }
}
