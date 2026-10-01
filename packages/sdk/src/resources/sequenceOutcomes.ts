import type {
  CursorPage,
  SequenceAutonomyLevel,
  SequenceEvaluationMembership,
  SequenceOutcome,
  SequenceOutcomeLeakageGroups,
  SequenceOutcomeSource,
  SequenceOutcomeType,
} from "../types.js";
import { BaseResource } from "./base.js";

export interface SetSequenceOutcomeSubtask {
  label: string;
  startTs: number;
  endTs: number;
  outcome?: SequenceOutcomeType | null;
}

/**
 * Body of a set call. The server replaces the current label wholesale and
 * records a new version: omitted optional fields are stored as unset, not
 * carried over from the previous version.
 */
export interface SetSequenceOutcomeOptions {
  outcome: SequenceOutcomeType;
  progress?: number | null;
  quality?: number | null;
  speed?: number | null;
  subtasks?: SetSequenceOutcomeSubtask[];
  mistakeType?: string;
  recoveryType?: string;
  failureStage?: string;
  autonomyLevel?: SequenceAutonomyLevel | "";
  modelVersion?: string;
  evaluationMembership?: SequenceEvaluationMembership | "";
  leakageGroups?: SequenceOutcomeLeakageGroups;
  source?: SequenceOutcomeSource;
  confidence?: number | null;
}

type OneOrMany<T> = T | readonly T[];

export interface ListSequenceOutcomesOptions {
  outcome?: OneOrMany<SequenceOutcomeType>;
  evaluationMembership?: OneOrMany<SequenceEvaluationMembership>;
  source?: OneOrMany<SequenceOutcomeSource>;
  autonomyLevel?: OneOrMany<SequenceAutonomyLevel>;
  modelVersion?: string;
  limit?: number;
  cursor?: string;
}

const SCALAR_KEYS: Record<string, string> = {
  outcome: "outcome",
  progress: "progress",
  quality: "quality",
  speed: "speed",
  mistakeType: "mistake_type",
  recoveryType: "recovery_type",
  failureStage: "failure_stage",
  autonomyLevel: "autonomy_level",
  modelVersion: "model_version",
  evaluationMembership: "evaluation_membership",
  source: "source",
  confidence: "confidence",
};

const LEAKAGE_KEYS: Record<keyof SequenceOutcomeLeakageGroups, string> = {
  location: "location",
  object: "object",
  mechanism: "mechanism",
  operator: "operator",
  environmentFamily: "environment_family",
};

function outcomePath(owner: string, slug: string, sequenceUid: string): string {
  return `/datasets/${owner}/${slug}/sequences/${sequenceUid}/outcome/`;
}

function joinFilter(value: OneOrMany<string> | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  return value.length > 0 ? value.join(",") : undefined;
}

function toPayload(options: SetSequenceOutcomeOptions): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [camel, snake] of Object.entries(SCALAR_KEYS)) {
    const value = (options as unknown as Record<string, unknown>)[camel];
    if (value !== undefined) payload[snake] = value;
  }
  if (options.subtasks !== undefined) {
    payload.subtasks = options.subtasks.map((subtask) => ({
      label: subtask.label,
      start_ts: subtask.startTs,
      end_ts: subtask.endTs,
      outcome: subtask.outcome ?? null,
    }));
  }
  if (options.leakageGroups !== undefined) {
    const groups: Record<string, string> = {};
    for (const [camel, snake] of Object.entries(LEAKAGE_KEYS)) {
      const value = options.leakageGroups[camel as keyof SequenceOutcomeLeakageGroups];
      if (value !== undefined) groups[snake] = value;
    }
    payload.leakage_groups = groups;
  }
  return payload;
}

/** Behavioral outcome labels of dataset sequences. */
export class SequenceOutcomesResource extends BaseResource {
  /** Current label of one sequence. Rejects with `NotFoundError` when it is unlabeled. */
  async get(owner: string, slug: string, sequenceUid: string): Promise<SequenceOutcome> {
    return this.http.requestSingle<SequenceOutcome>(outcomePath(owner, slug, sequenceUid));
  }

  /** Record a new current label (requires edit access to the dataset). */
  async set(
    owner: string,
    slug: string,
    sequenceUid: string,
    options: SetSequenceOutcomeOptions,
  ): Promise<SequenceOutcome> {
    return this.http.requestPut<SequenceOutcome>(outcomePath(owner, slug, sequenceUid), toPayload(options));
  }

  /** Every version of one sequence's label, newest first. */
  async history(owner: string, slug: string, sequenceUid: string): Promise<SequenceOutcome[]> {
    return this.http.requestList<SequenceOutcome>(`${outcomePath(owner, slug, sequenceUid)}history/`);
  }

  /** Current labels in a dataset. Enum filters accept one value or a list (OR). */
  async list(owner: string, slug: string, options?: ListSequenceOutcomesOptions): Promise<CursorPage<SequenceOutcome>> {
    const params: Record<string, string> = {};
    const filters: Record<string, string | undefined> = {
      outcome: joinFilter(options?.outcome),
      evaluation_membership: joinFilter(options?.evaluationMembership),
      source: joinFilter(options?.source),
      autonomy_level: joinFilter(options?.autonomyLevel),
      model_version: options?.modelVersion,
      cursor: options?.cursor,
    };
    for (const [key, value] of Object.entries(filters)) {
      if (value) params[key] = value;
    }
    if (options?.limit !== undefined) params.limit = String(options.limit);
    return this.http.requestPage<SequenceOutcome>(
      `/datasets/${owner}/${slug}/sequence-outcomes/`,
      Object.keys(params).length > 0 ? params : undefined,
    );
  }
}
