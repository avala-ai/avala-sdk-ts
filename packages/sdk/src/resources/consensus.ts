import type { ConsensusComputeResult, ConsensusConfig, ConsensusScore, ConsensusSummary, CursorPage } from "../types.js";
import { BaseResource } from "./base.js";

export interface UpdateConsensusConfigOptions {
  iouThreshold?: number;
  minAgreementRatio?: number;
  minAnnotations?: number;
}

export class ConsensusResource extends BaseResource {
  async getSummary(projectUid: string): Promise<ConsensusSummary> {
    return this.http.requestSingle<ConsensusSummary>(`/projects/${projectUid}/consensus/`);
  }

  async listScores(projectUid: string, options?: { limit?: number; cursor?: string }): Promise<CursorPage<ConsensusScore>> {
    const params: Record<string, string> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<ConsensusScore>(
      `/projects/${projectUid}/consensus/scores/`,
      Object.keys(params).length > 0 ? params : undefined,
    );
  }

  async compute(projectUid: string): Promise<ConsensusComputeResult> {
    return this.http.requestCreate<ConsensusComputeResult>(`/projects/${projectUid}/consensus/compute/`, {});
  }

  async getConfig(projectUid: string): Promise<ConsensusConfig> {
    return this.http.requestSingle<ConsensusConfig>(`/projects/${projectUid}/consensus/config/`);
  }

  async updateConfig(projectUid: string, options: UpdateConsensusConfigOptions): Promise<ConsensusConfig> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      iouThreshold: "iou_threshold",
      minAgreementRatio: "min_agreement_ratio",
      minAnnotations: "min_annotations",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    const raw = await this.http.request<Record<string, unknown>>("PUT", `/projects/${projectUid}/consensus/config/`, { json: payload });
    // PUT doesn't use requestUpdate (which is PATCH), so convert manually
    const snakeToCamel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      result[snakeToCamel(key)] = value;
    }
    return result as unknown as ConsensusConfig;
  }
}
