import { AvalaError } from "../errors.js";
import type { CustomerQcContext, CustomerQcContextTarget, CustomerQcDecision } from "../types.js";
import { BaseResource } from "./base.js";

// Unlike $, the final negative lookahead rejects even a trailing line break.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/;
const SHA256 = /^[0-9a-f]{64}(?![\s\S])/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidResponse(): never {
  // Do not attach upstream data to errors; it may contain unreviewed fields.
  throw new AvalaError("Invalid customer QC context response.");
}

function readString(raw: Record<string, unknown>, key: string, pattern?: RegExp): string {
  const value = raw[key];
  if (typeof value !== "string" || (pattern && !pattern.test(value))) invalidResponse();
  return value;
}

function parseContext(raw: unknown, target: CustomerQcContextTarget): CustomerQcContext {
  if (
    !isRecord(raw) || raw.schema_version !== 1 || raw.evidence_kind !== "workflow_metadata_only" ||
    raw.decision_ready !== false || raw.annotation_scope !== "cuboid_3d" ||
    raw.organization_uid !== target.organizationUid || raw.dataset_uid !== target.datasetUid ||
    raw.sequence_uid !== target.sequenceUid || raw.deliverable_id !== target.deliverableId ||
    !Array.isArray(raw.available_decisions) || !Array.isArray(raw.blockers) || raw.blockers.length === 0
  ) invalidResponse();

  const availableDecisions: CustomerQcDecision[] = raw.available_decisions.map((decision: unknown) => {
    if (
      !isRecord(decision) || typeof decision.state !== "string" ||
      (decision.outcome !== "approved" && decision.outcome !== "rejected")
    ) invalidResponse();
    return { state: decision.state, outcome: decision.outcome };
  });
  const blockers = raw.blockers.map((blocker: unknown) => {
    if (typeof blocker !== "string" || blocker.length === 0) invalidResponse();
    return blocker;
  });

  // Project reviewed fields only. Never manufacture readiness from available
  // transitions, recompute a receipt, or return arbitrary future payload fields.
  return {
    ...target,
    schemaVersion: raw.schema_version,
    evidenceKind: raw.evidence_kind,
    annotationScope: raw.annotation_scope,
    workflowRevisionUid: readString(raw, "workflow_revision_uid", UUID),
    workflowDefinitionSha256: readString(raw, "workflow_definition_sha256", SHA256),
    stateCreatedAt: readString(raw, "state_created_at"),
    stateUpdatedAt: readString(raw, "state_updated_at"),
    workflowState: readString(raw, "workflow_state"),
    approvalState: readString(raw, "approval_state"),
    approvalOutcome: readString(raw, "approval_outcome"),
    availableDecisions,
    decisionReady: raw.decision_ready,
    blockers,
    contextSha256: readString(raw, "context_sha256", SHA256),
  };
}

/** Read-only customer workflow inspection. Enrollment and authorization remain server-owned. */
export class CustomerQcResource extends BaseResource {
  /**
   * Requires an enrolled nonstaff organization editor and delegated scopes
   * datasets.read + qc.read. A default-off/unauthorized target is not retried
   * through legacy QC routes. No proposal or approval action is exposed here.
   */
  async inspectContext(target: CustomerQcContextTarget): Promise<CustomerQcContext> {
    if (!isRecord(target)) throw new AvalaError("Invalid customer QC target.");
    // Snapshot before I/O so caller mutations cannot rebind the response check.
    const { organizationUid, datasetUid, sequenceUid, deliverableId } = target;
    if (
      ![organizationUid, datasetUid, sequenceUid].every((uid) => typeof uid === "string" && UUID.test(uid)) ||
      deliverableId !== "cuboids"
    ) throw new AvalaError("Invalid customer QC target.");
    const identity = { organizationUid, datasetUid, sequenceUid, deliverableId };
    const raw = await this.http.request<unknown>(
      "GET",
      `/customer-qc/organizations/${organizationUid}/datasets/${datasetUid}/sequences/${sequenceUid}` +
      `/deliverables/${deliverableId}/context/`,
    );
    return parseContext(raw, identity);
  }
}
