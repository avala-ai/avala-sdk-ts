import { snakeToCamel } from "../http.js";
import type { AnnotationIssue, AnnotationIssueMetrics, AnnotationIssueToolDetail } from "../types.js";
import { BaseResource } from "./base.js";

export interface CreateAnnotationIssueOptions {
  toolUid: string;
  problemUid: string;
  datasetItemUid?: string;
  projectUid?: string;
  priority?: string;
  severity?: string;
  description?: string;
  wrongClass?: string;
  correctClass?: string;
  shouldReAnnotate?: boolean;
  shouldDelete?: boolean;
  framesAffected?: string;
  coordinates?: unknown;
  queryParams?: Record<string, unknown>;
  objectUid?: string;
}

export interface UpdateAnnotationIssueOptions {
  status?: string;
  priority?: string;
  severity?: string;
  description?: string;
  toolUid?: string;
  problemUid?: string;
  wrongClass?: string;
  framesAffected?: string;
}

export class AnnotationIssuesResource extends BaseResource {
  // Sequence-scoped CRUD

  async listBySequence(
    sequenceUid: string,
    options?: { datasetItemUid?: string; projectUid?: string },
  ): Promise<AnnotationIssue[]> {
    const params: Record<string, string> = {};
    if (options?.datasetItemUid) params.dataset_item_uid = options.datasetItemUid;
    if (options?.projectUid) params.project_uid = options.projectUid;
    return this.http.requestList<AnnotationIssue>(
      `/sequences/${sequenceUid}/annotation-issues/`,
      Object.keys(params).length > 0 ? params : undefined,
    );
  }

  async create(
    sequenceUid: string,
    options: CreateAnnotationIssueOptions,
  ): Promise<AnnotationIssue> {
    const payload: Record<string, unknown> = { sequence_uid: sequenceUid };
    const keyMap: Record<string, string> = {
      toolUid: "tool_uid",
      problemUid: "problem_uid",
      datasetItemUid: "dataset_item_uid",
      projectUid: "project_uid",
      priority: "priority",
      severity: "severity",
      description: "description",
      wrongClass: "wrong_class",
      correctClass: "correct_class",
      shouldReAnnotate: "should_re_annotate",
      shouldDelete: "should_delete",
      framesAffected: "frames_affected",
      coordinates: "coordinates",
      queryParams: "query_params",
      objectUid: "object_uid",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    return this.http.requestCreate<AnnotationIssue>(
      `/sequences/${sequenceUid}/annotation-issues/`,
      payload,
    );
  }

  async update(
    sequenceUid: string,
    issueUid: string,
    options: UpdateAnnotationIssueOptions,
  ): Promise<AnnotationIssue> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      status: "status",
      priority: "priority",
      severity: "severity",
      description: "description",
      toolUid: "tool_uid",
      problemUid: "problem_uid",
      wrongClass: "wrong_class",
      framesAffected: "frames_affected",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    return this.http.requestUpdate<AnnotationIssue>(
      `/sequences/${sequenceUid}/annotation-issues/${issueUid}/`,
      payload,
    );
  }

  async delete(sequenceUid: string, issueUid: string): Promise<void> {
    await this.http.request("DELETE", `/sequences/${sequenceUid}/annotation-issues/${issueUid}/`);
  }

  // Dataset-scoped

  async listByDataset(
    owner: string,
    datasetSlug: string,
    options?: { sequenceUid?: string },
  ): Promise<AnnotationIssue[]> {
    const params: Record<string, string> = {};
    if (options?.sequenceUid) params.sequence_uid = options.sequenceUid;
    return this.http.requestList<AnnotationIssue>(
      `/datasets/${owner}/${datasetSlug}/annotation-issues/`,
      Object.keys(params).length > 0 ? params : undefined,
    );
  }

  async getMetrics(
    owner: string,
    datasetSlug: string,
    options?: { sequenceUid?: string },
  ): Promise<AnnotationIssueMetrics> {
    const params: Record<string, string> = {};
    if (options?.sequenceUid) params.sequence_uid = options.sequenceUid;
    const raw = await this.http.request<Record<string, unknown>>(
      "GET",
      `/datasets/${owner}/${datasetSlug}/annotation-issues/metrics/`,
      { params: Object.keys(params).length > 0 ? params : undefined },
    );
    return snakeToCamel(raw) as unknown as AnnotationIssueMetrics;
  }

  // Tools

  async listTools(options: { datasetType: string }): Promise<AnnotationIssueToolDetail[]> {
    return this.http.requestList<AnnotationIssueToolDetail>(
      "/qc-available-tools/",
      { dataset_type: options.datasetType },
    );
  }
}
