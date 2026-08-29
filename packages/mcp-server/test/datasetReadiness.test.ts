import { describe, expect, it } from "vitest";
import { assessDatasetReadiness } from "../src/datasetReadiness.js";

const sfLidarHealth = {
  datasetUid: "ds-1",
  datasetSlug: "sf-lidar",
  datasetStatus: "created",
  ingestOk: true,
  issues: [],
  sequenceCount: 39,
  frameCount: 3120,
  sequences: [
    {
      uid: "seq-1",
      hasLidarCalibration: false,
      hasCameraCalibration: false,
    },
  ],
};

describe("assessDatasetReadiness", () => {
  it("does not emit a ready flag or a score", () => {
    const result = assessDatasetReadiness(sfLidarHealth);
    expect(result).not.toHaveProperty("ready");
    expect(result).not.toHaveProperty("score");
    expect(result.purpose).toBe("reconstruction");
  });

  it("treats all-missing calibration as blocking even when ingestOk is true", () => {
    const result = assessDatasetReadiness(sfLidarHealth);
    expect(result.blockingReasons).toEqual([
      "lidar_calibration",
      "camera_calibration",
    ]);
    expect(result.unmeasured).toEqual([]);
    const ingest = result.checks.find((check) => check.key === "ingest");
    expect(ingest?.status).toBe("pass");
  });

  it("does not convert a missing sequences array into a fail", () => {
    const result = assessDatasetReadiness({
      ingestOk: true,
      sequenceCount: 4,
      frameCount: 100,
    });
    expect(
      result.checks
        .filter((check) => check.status === "fail")
        .map((check) => check.key),
    ).toEqual([]);
    expect(result.unmeasured).toEqual([
      "lidar_calibration",
      "camera_calibration",
    ]);
  });

  it("skips calibration when there are no sequences", () => {
    const result = assessDatasetReadiness({
      ingestOk: true,
      issues: [],
      sequenceCount: 0,
      frameCount: 0,
      sequences: [],
    });
    const lidar = result.checks.find(
      (check) => check.key === "lidar_calibration",
    );
    expect(lidar?.status).toBe("skipped");
    expect(result.blockingReasons).toEqual(["has_sequences", "has_frames"]);
  });
});
