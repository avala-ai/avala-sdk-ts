// Synthetic metadata only; no pilot enrollment or production authorization.
export const customerQcTarget = {
  organizationUid: "00000000-0000-0000-0000-000000000001",
  datasetUid: "00000000-0000-0000-0000-000000000002",
  sequenceUid: "00000000-0000-0000-0000-000000000003",
  deliverableId: "cuboids",
};

export const customerQcWireContext = {
  schema_version: 1,
  evidence_kind: "workflow_metadata_only",
  organization_uid: customerQcTarget.organizationUid,
  dataset_uid: customerQcTarget.datasetUid,
  sequence_uid: customerQcTarget.sequenceUid,
  deliverable_id: customerQcTarget.deliverableId,
  annotation_scope: "cuboid_3d",
  workflow_revision_uid: "00000000-0000-0000-0000-000000000004",
  workflow_definition_sha256: "a".repeat(64),
  state_created_at: "2026-09-14T00:00:00Z",
  state_updated_at: "2026-09-14T00:01:00Z",
  workflow_state: "customer_review",
  approval_state: "",
  approval_outcome: "",
  available_decisions: [{ state: "customer_approved", outcome: "approved" }],
  decision_ready: false,
  blockers: [
    "annotation_revision_fence_missing",
    "independent_proposal_approval_missing",
  ],
  context_sha256: "b".repeat(64),
};
