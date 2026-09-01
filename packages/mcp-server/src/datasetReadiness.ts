/**
 * Reconstruction readiness derived from DatasetHealthView.
 *
 * `get_dataset_health` reports `ingestOk: true, issues: []` for datasets where
 * every sequence is missing both LiDAR and camera calibration. For a 4DGS
 * pipeline that is a live wrong answer. This module turns the same customer-
 * reachable health payload into named checks using the acceptance-engine
 * vocabulary (`pass` / `fail` / `insufficient_evidence` / `skipped`).
 *
 * A check that could not be run is `insufficient_evidence`, never a pass and
 * never a fail. Missing calibration is blocking only when the selected recipe
 * requires that artifact. There is no ready boolean and no opaque score —
 * every outcome expands to evidence.
 */

export const CALIBRATION_KINDS = ["camera", "lidar"] as const;

export type CalibrationKind = (typeof CALIBRATION_KINDS)[number];

export const CRITERION_STATUSES = [
  "pass",
  "fail",
  "insufficient_evidence",
  "skipped",
] as const;

export type CriterionStatus = (typeof CRITERION_STATUSES)[number];

export type CheckSeverity = "blocking" | null;

export interface ReadinessCheck {
  key: string;
  status: CriterionStatus;
  severity: CheckSeverity;
  reason: string;
  remediation: string | null;
  evidence: Record<string, unknown>;
}

export interface DatasetReadiness {
  datasetUid: string | null;
  datasetSlug: string | null;
  datasetStatus: string | null;
  purpose: "reconstruction";
  sequenceCount: number | null;
  frameCount: number | null;
  assetCount: number | null;
  requiredCalibrations: CalibrationKind[];
  summary: string;
  checks: ReadinessCheck[];
  blockingReasons: string[];
  unmeasured: string[];
}

interface HealthSequence {
  uid?: string;
  key?: string | null;
  hasLidarCalibration?: boolean;
  hasCameraCalibration?: boolean;
}

interface HealthPayload {
  datasetUid?: string | null;
  datasetSlug?: string | null;
  datasetStatus?: string | null;
  isSequence?: boolean;
  ingestOk?: boolean;
  issues?: unknown;
  sequences?: unknown;
  sequenceCount?: number;
  frameCount?: number;
  totalFrames?: number;
  assetCount?: number;
  itemCount?: number;
}

function asRecord(value: unknown): HealthPayload {
  if (typeof value !== "object" || value === null) return {};
  return value as HealthPayload;
}

function sequencesOf(health: HealthPayload): HealthSequence[] | null {
  if (!Array.isArray(health.sequences)) return null;
  return health.sequences.filter(
    (item): item is HealthSequence =>
      typeof item === "object" && item !== null,
  );
}

function frameTotal(health: HealthPayload): number | null {
  if (health.isSequence === false) return null;
  const isDeclaredOrObservedSequence =
    health.isSequence === true ||
    (typeof health.sequenceCount === "number" && health.sequenceCount > 0);
  if (!isDeclaredOrObservedSequence) return null;
  // `totalFrames` FIRST. `DatasetHealthView` computes it live by summing the
  // sequences, whereas `frameCount`/`itemCount` are denormalized counters that
  // are allowed to lag — `dataset/tests/test_live_dataset_sync.py` exists
  // because that lag is a real, handled state. Reading the stale counter first
  // reports `has_frames` as FAILED on a dataset the server has just counted as
  // non-empty, which is the worst kind of wrong answer here: a readiness check
  // telling a customer their data is missing when it is not.
  //
  // A non-sequence VIDEO/image dataset legitimately has `totalFrames: 0`, but
  // that is a non-applicable counter rather than a measured frame zero. The
  // shape guard above suppresses it and `inputMediaCheck` evaluates the
  // dataset's unit-bearing `assetCount` instead.
  if (typeof health.totalFrames === "number") return health.totalFrames;
  if (typeof health.frameCount === "number") return health.frameCount;
  if (
    typeof health.sequenceCount === "number" &&
    health.sequenceCount > 0 &&
    typeof health.itemCount === "number"
  ) {
    return health.itemCount;
  }
  return null;
}

function assetTotal(health: HealthPayload): number | null {
  if (health.isSequence !== false) return null;
  if (typeof health.assetCount === "number") return health.assetCount;
  if (typeof health.itemCount === "number") {
    return health.itemCount;
  }
  return null;
}

function sequenceTotal(
  health: HealthPayload,
  sequences: HealthSequence[] | null,
): number | null {
  if (typeof health.sequenceCount === "number") return health.sequenceCount;
  return sequences === null ? null : sequences.length;
}

function check(
  key: string,
  status: CriterionStatus,
  reason: string,
  options: {
    severity?: CheckSeverity;
    remediation?: string | null;
    evidence?: Record<string, unknown>;
  } = {},
): ReadinessCheck {
  const failed = status === "fail";
  return {
    key,
    status,
    severity: failed ? (options.severity ?? "blocking") : null,
    reason,
    remediation: failed ? (options.remediation ?? null) : null,
    evidence: options.evidence ?? {},
  };
}

function calibrationCheck(
  key: "lidar_calibration" | "camera_calibration",
  label: "LiDAR" | "camera",
  sequences: HealthSequence[] | null,
  flag: "hasLidarCalibration" | "hasCameraCalibration",
  required: boolean,
): ReadinessCheck {
  if (!required) {
    return check(
      key,
      "skipped",
      `${label} calibration is not required by the selected reconstruction recipe.`,
      { evidence: { required: false } },
    );
  }
  if (sequences === null) {
    return check(
      key,
      "insufficient_evidence",
      `The health payload did not include per-sequence ${label} calibration flags, so this check was not measured.`,
      { evidence: { required: true, sequencesPresent: false } },
    );
  }
  if (sequences.length === 0) {
    return check(
      key,
      "skipped",
      `No sequences to inspect for ${label} calibration.`,
      { evidence: { required: true, sequencesChecked: 0 } },
    );
  }

  const missing = sequences.filter((sequence) => sequence[flag] !== true);
  const missingUids = missing
    .map((sequence) => sequence.uid)
    .filter((uid): uid is string => typeof uid === "string");

  if (missing.length === sequences.length) {
    return check(
      key,
      "fail",
      `Every sequence is missing ${label} calibration required by the selected reconstruction recipe.`,
      {
        severity: "blocking",
        remediation: `Calibrate ${label} on each sequence (upload the canonical rig, or call get_calibration after a successful calibration write), then run this check again.`,
        evidence: {
          required: true,
          sequencesChecked: sequences.length,
          missingCount: missing.length,
          missingSequenceUids: missingUids,
        },
      },
    );
  }
  if (missing.length > 0) {
    return check(
      key,
      "fail",
      `${missing.length} of ${sequences.length} sequences are missing ${label} calibration.`,
      {
        severity: "blocking",
        remediation: `Calibrate ${label} on the sequences listed in evidence. Reconstruction is blocked for those recording runs.`,
        evidence: {
          required: true,
          sequencesChecked: sequences.length,
          missingCount: missing.length,
          missingSequenceUids: missingUids,
        },
      },
    );
  }
  return check(key, "pass", `Every sequence has ${label} calibration.`, {
    evidence: {
      required: true,
      sequencesChecked: sequences.length,
      missingCount: 0,
    },
  });
}

function normalizeRequiredCalibrations(
  required: readonly CalibrationKind[],
): CalibrationKind[] {
  const selected = new Set(required);
  return CALIBRATION_KINDS.filter((kind) => selected.has(kind));
}

function ingestCheck(health: HealthPayload): ReadinessCheck {
  if (typeof health.ingestOk !== "boolean") {
    return check(
      "ingest",
      "insufficient_evidence",
      "The health payload did not include ingestOk, so ingest was not measured.",
    );
  }
  const issues = Array.isArray(health.issues)
    ? health.issues.filter((item): item is string => typeof item === "string")
    : [];
  if (!health.ingestOk) {
    return check(
      "ingest",
      "fail",
      "Ingest reported a failure. Reconstruction cannot start on a dataset that did not finish landing.",
      {
        severity: "blocking",
        remediation:
          "Fix the ingest issues, wait for a successful re-ingest, then call this tool again.",
        evidence: { ingestOk: false, issueCount: issues.length, issues },
      },
    );
  }
  return check("ingest", "pass", "Ingest completed without a reported failure.", {
    evidence: { ingestOk: true, issueCount: issues.length, issues },
  });
}

function sequenceCountCheck(
  health: HealthPayload,
  sequences: HealthSequence[] | null,
  required: boolean,
): ReadinessCheck {
  const counted = sequenceTotal(health, sequences);
  if (counted === null) {
    if (!required) {
      return check(
        "has_sequences",
        "skipped",
        "The selected recipe does not require stored per-sequence calibration, so sequence count is not required.",
        { evidence: { required: false } },
      );
    }
    return check(
      "has_sequences",
      "insufficient_evidence",
      "Neither sequenceCount nor a sequences array was present, so recording-run count was not measured.",
    );
  }
  if (counted === 0) {
    if (!required) {
      return check(
        "has_sequences",
        "skipped",
        "The selected recipe does not require stored per-sequence calibration, so non-sequence media is allowed.",
        { evidence: { required: false, sequenceCount: 0 } },
      );
    }
    return check(
      "has_sequences",
      "fail",
      "This dataset has no sequences (recording runs).",
      {
        severity: "blocking",
        remediation:
          "Ingest at least one sequence before asking whether reconstruction can start.",
        evidence: { required: true, sequenceCount: 0 },
      },
    );
  }
  return check("has_sequences", "pass", `Dataset has ${counted} sequences.`, {
    evidence: { required, sequenceCount: counted },
  });
}

function frameCountCheck(health: HealthPayload): ReadinessCheck {
  const frames = frameTotal(health);
  if (frames === null) {
    return check(
      "has_frames",
      "insufficient_evidence",
      "The health payload did not include a frame total, so this check was not measured.",
    );
  }
  if (frames === 0) {
    return check(
      "has_frames",
      "fail",
      "Sequences have landed but report zero frames.",
      {
        severity: "blocking",
        remediation:
          "Wait for ingest to finish writing frames, then call this tool again.",
        evidence: { frameCount: 0 },
      },
    );
  }
  return check("has_frames", "pass", `Dataset has ${frames} frames.`, {
    evidence: { frameCount: frames },
  });
}

function assetCountCheck(health: HealthPayload): ReadinessCheck {
  const assets = assetTotal(health);
  if (assets === null) {
    return check(
      "has_assets",
      "insufficient_evidence",
      "The health payload did not include a non-sequence asset count, so input media was not measured.",
    );
  }
  if (assets === 0) {
    return check(
      "has_assets",
      "fail",
      "This non-sequence dataset has no media assets.",
      {
        severity: "blocking",
        remediation:
          "Ingest at least one media asset, then call this tool again.",
        evidence: { assetCount: 0 },
      },
    );
  }
  return check("has_assets", "pass", `Dataset has ${assets} media assets.`, {
    evidence: { assetCount: assets },
  });
}

function inputMediaCheck(
  health: HealthPayload,
  sequences: HealthSequence[] | null,
): ReadinessCheck {
  if (health.isSequence === true) return frameCountCheck(health);
  if (health.isSequence === false) return assetCountCheck(health);
  const sequenceCount = sequenceTotal(health, sequences);
  if (sequenceCount !== null && sequenceCount > 0) {
    return frameCountCheck(health);
  }
  return check(
    "input_media_shape",
    "insufficient_evidence",
    "The health payload did not declare whether this dataset is sequence-shaped, so its item count cannot be interpreted safely.",
  );
}

function summarize(checks: ReadinessCheck[]): string {
  const blocking = checks.filter(
    (item) => item.status === "fail" && item.severity === "blocking",
  );
  const unmeasured = checks.filter(
    (item) => item.status === "insufficient_evidence",
  );
  if (blocking.length > 0) {
    return `Reconstruction is blocked: ${blocking.map((item) => item.reason).join(" ")}`;
  }
  if (unmeasured.length > 0) {
    return `Cannot decide reconstruction readiness: ${unmeasured.map((item) => item.key).join(", ")} could not be measured.`;
  }
  return "No blocking reconstruction checks failed. Remaining checks passed or were skipped.";
}

function slimEvidence(
  evidence: Record<string, unknown>,
): Record<string, unknown> {
  const { missingSequenceUids: _uids, issues: _issues, ...rest } = evidence;
  return rest;
}

/**
 * Turn a DatasetHealthView payload into named reconstruction checks.
 * `detail=full` keeps per-sequence uids and ingest issue strings;
 * concise keeps counts only.
 */
export function assessDatasetReadiness(
  value: unknown,
  requiredCalibrations: readonly CalibrationKind[],
  detail: "concise" | "full" = "concise",
): DatasetReadiness {
  const health = asRecord(value);
  const sequences = sequencesOf(health);
  const normalizedRequiredCalibrations = normalizeRequiredCalibrations(
    requiredCalibrations,
  );
  const requires = new Set(normalizedRequiredCalibrations);
  const requiresSequences = normalizedRequiredCalibrations.length > 0;
  const checks = [
    ingestCheck(health),
    sequenceCountCheck(health, sequences, requiresSequences),
    inputMediaCheck(health, sequences),
    calibrationCheck(
      "lidar_calibration",
      "LiDAR",
      sequences,
      "hasLidarCalibration",
      requires.has("lidar"),
    ),
    calibrationCheck(
      "camera_calibration",
      "camera",
      sequences,
      "hasCameraCalibration",
      requires.has("camera"),
    ),
  ].map((item) =>
    detail === "full"
      ? item
      : { ...item, evidence: slimEvidence(item.evidence) },
  );

  return {
    datasetUid: typeof health.datasetUid === "string" ? health.datasetUid : null,
    datasetSlug:
      typeof health.datasetSlug === "string" ? health.datasetSlug : null,
    datasetStatus:
      typeof health.datasetStatus === "string" ? health.datasetStatus : null,
    purpose: "reconstruction",
    sequenceCount: sequenceTotal(health, sequences),
    frameCount: frameTotal(health),
    assetCount: assetTotal(health),
    requiredCalibrations: normalizedRequiredCalibrations,
    summary: summarize(checks),
    checks,
    blockingReasons: checks
      .filter((item) => item.status === "fail" && item.severity === "blocking")
      .map((item) => item.key),
    unmeasured: checks
      .filter((item) => item.status === "insufficient_evidence")
      .map((item) => item.key),
  };
}
