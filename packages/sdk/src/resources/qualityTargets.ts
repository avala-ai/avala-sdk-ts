import type { CursorPage, QualityTarget, QualityTargetEvaluation } from "../types.js";
import { BaseResource } from "./base.js";

export interface CreateQualityTargetOptions {
  name: string;
  metric: string;
  operator: string;
  threshold: number;
  severity?: string;
  isActive?: boolean;
  notifyWebhook?: boolean;
  notifyEmails?: string[];
}

export interface UpdateQualityTargetOptions {
  name?: string;
  metric?: string;
  operator?: string;
  threshold?: number;
  severity?: string;
  isActive?: boolean;
  notifyWebhook?: boolean;
  notifyEmails?: string[];
}

export class QualityTargetsResource extends BaseResource {
  async list(projectUid: string, options?: { limit?: number; cursor?: string }): Promise<CursorPage<QualityTarget>> {
    const params: Record<string, string> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<QualityTarget>(
      `/projects/${projectUid}/quality-targets/`,
      Object.keys(params).length > 0 ? params : undefined,
    );
  }

  async create(projectUid: string, options: CreateQualityTargetOptions): Promise<QualityTarget> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      name: "name",
      metric: "metric",
      operator: "operator",
      threshold: "threshold",
      severity: "severity",
      isActive: "is_active",
      notifyWebhook: "notify_webhook",
      notifyEmails: "notify_emails",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    return this.http.requestCreate<QualityTarget>(`/projects/${projectUid}/quality-targets/`, payload);
  }

  async get(projectUid: string, uid: string): Promise<QualityTarget> {
    return this.http.requestSingle<QualityTarget>(`/projects/${projectUid}/quality-targets/${uid}/`);
  }

  async update(projectUid: string, uid: string, options: UpdateQualityTargetOptions): Promise<QualityTarget> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      name: "name",
      metric: "metric",
      operator: "operator",
      threshold: "threshold",
      severity: "severity",
      isActive: "is_active",
      notifyWebhook: "notify_webhook",
      notifyEmails: "notify_emails",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    const raw = await this.http.request<Record<string, unknown>>("PATCH", `/projects/${projectUid}/quality-targets/${uid}/`, { json: payload });
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      result[camelKey] = value;
    }
    return result as unknown as QualityTarget;
  }

  async delete(projectUid: string, uid: string): Promise<void> {
    await this.http.request("DELETE", `/projects/${projectUid}/quality-targets/${uid}/`);
  }

  async evaluate(projectUid: string): Promise<QualityTargetEvaluation[]> {
    return this.http.request("POST", `/projects/${projectUid}/quality-targets/evaluate/`);
  }
}
