import { describe, expect, it } from "vitest";
import { assessDatasetReadiness } from "../src/datasetReadiness.js";

const cameraAndLidar = ["camera", "lidar"] as const;

const sfLidarHealth = {
  datasetUid: "ds-1",
  datasetSlug: "sf-lidar",
  datasetStatus: "created",
  isSequence: true,
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
    const result = assessDatasetReadiness(sfLidarHealth, cameraAndLidar);
    expect(result).not.toHaveProperty("ready");
    expect(result).not.toHaveProperty("score");
    expect(result.purpose).toBe("reconstruction");
    expect(result.requiredCalibrations).toEqual(["camera", "lidar"]);
    expect(result.assetCount).toBeNull();
  });

  it("treats all-missing calibration as blocking even when ingestOk is true", () => {
    const result = assessDatasetReadiness(sfLidarHealth, cameraAndLidar);
    expect(result.blockingReasons).toEqual([
      "lidar_calibration",
      "camera_calibration",
    ]);
    expect(result.unmeasured).toEqual([]);
    const ingest = result.checks.find((check) => check.key === "ingest");
    expect(ingest?.status).toBe("pass");
  });

  it("skips LiDAR calibration when the selected recipe only requires cameras", () => {
    const result = assessDatasetReadiness(
      {
        ...sfLidarHealth,
        sequences: [
          {
            uid: "seq-1",
            hasLidarCalibration: false,
            hasCameraCalibration: true,
          },
        ],
      },
      ["camera"],
    );

    const lidar = result.checks.find(
      (item) => item.key === "lidar_calibration",
    );
    const camera = result.checks.find(
      (item) => item.key === "camera_calibration",
    );
    expect(lidar).toMatchObject({
      status: "skipped",
      severity: null,
      evidence: { required: false },
    });
    expect(camera?.status).toBe("pass");
    expect(result.blockingReasons).toEqual([]);
  });

  it("skips stored calibration checks when the selected recipe estimates calibration", () => {
    const result = assessDatasetReadiness(sfLidarHealth, []);

    expect(
      result.checks
        .filter((item) => item.key.endsWith("_calibration"))
        .map((item) => item.status),
    ).toEqual(["skipped", "skipped"]);
    expect(result.requiredCalibrations).toEqual([]);
    expect(result.blockingReasons).toEqual([]);
  });

  it("accepts non-sequence video assets when stored calibration is not required", () => {
    const result = assessDatasetReadiness(
      {
        datasetUid: "ds-video",
        datasetSlug: "walkthrough",
        datasetStatus: "created",
        isSequence: false,
        ingestOk: true,
        issues: [],
        sequenceCount: 0,
        totalFrames: 0,
        itemCount: 2,
        sequences: [],
      },
      [],
    );

    expect(result).toMatchObject({
      sequenceCount: 0,
      frameCount: null,
      assetCount: 2,
      blockingReasons: [],
      unmeasured: [],
    });
    expect(
      result.checks.find((item) => item.key === "has_sequences"),
    ).toMatchObject({
      status: "skipped",
      evidence: { required: false, sequenceCount: 0 },
    });
    expect(
      result.checks.find((item) => item.key === "has_assets"),
    ).toMatchObject({ status: "pass", evidence: { assetCount: 2 } });
    expect(result.checks.some((item) => item.key === "has_frames")).toBe(
      false,
    );
  });

  it("still requires sequences when the recipe requires stored calibration", () => {
    const result = assessDatasetReadiness(
      {
        isSequence: false,
        ingestOk: true,
        issues: [],
        sequenceCount: 0,
        totalFrames: 0,
        itemCount: 2,
        sequences: [],
      },
      ["camera"],
    );

    expect(result.blockingReasons).toEqual(["has_sequences"]);
    expect(
      result.checks.find((item) => item.key === "has_assets"),
    ).toMatchObject({ status: "pass", evidence: { assetCount: 2 } });
  });

  it("does not relabel sequence items as assets when live frame count is zero", () => {
    const result = assessDatasetReadiness(
      {
        isSequence: true,
        ingestOk: true,
        issues: [],
        sequenceCount: 1,
        totalFrames: 0,
        itemCount: 2,
        sequences: [
          {
            uid: "seq-1",
            hasLidarCalibration: true,
            hasCameraCalibration: true,
          },
        ],
      },
      [],
    );

    expect(result.assetCount).toBeNull();
    expect(result.blockingReasons).toEqual(["has_frames"]);
    expect(
      result.checks.find((item) => item.key === "has_frames"),
    ).toMatchObject({ status: "fail", evidence: { frameCount: 0 } });
    expect(result.checks.some((item) => item.key === "has_assets")).toBe(
      false,
    );
  });

  it("marks an undeclared zero-sequence content shape as unmeasured", () => {
    const result = assessDatasetReadiness(
      {
        ingestOk: true,
        issues: [],
        sequenceCount: 0,
        totalFrames: 0,
        itemCount: 6,
        sequences: [],
      },
      [],
    );

    expect(result.frameCount).toBeNull();
    expect(result.assetCount).toBeNull();
    expect(result.blockingReasons).toEqual([]);
    expect(result.unmeasured).toContain("input_media_shape");
    expect(
      result.checks.find((item) => item.key === "input_media_shape"),
    ).toMatchObject({ status: "insufficient_evidence", severity: null });
  });

  it("lets a declared non-sequence shape outrank stray sequence counters", () => {
    const result = assessDatasetReadiness(
      {
        isSequence: false,
        ingestOk: true,
        issues: [],
        sequenceCount: 1,
        totalFrames: 80,
        itemCount: 2,
        sequences: [],
      },
      [],
    );

    expect(result.frameCount).toBeNull();
    expect(result.assetCount).toBe(2);
    expect(
      result.checks.find((item) => item.key === "has_assets"),
    ).toMatchObject({ status: "pass", evidence: { assetCount: 2 } });
    expect(result.checks.some((item) => item.key === "has_frames")).toBe(
      false,
    );
  });

  it("prefers the live sequence frame total over a stale dataset counter", () => {
    const result = assessDatasetReadiness(
      {
        ...sfLidarHealth,
        frameCount: 0,
        totalFrames: 80,
        sequences: [
          {
            uid: "seq-1",
            hasLidarCalibration: true,
            hasCameraCalibration: true,
          },
        ],
      },
      cameraAndLidar,
    );

    expect(result.frameCount).toBe(80);
    expect(
      result.checks.find((item) => item.key === "has_frames"),
    ).toMatchObject({ status: "pass", evidence: { frameCount: 80 } });
  });

  it("does not convert a missing sequences array into a fail", () => {
    const result = assessDatasetReadiness(
      {
        isSequence: true,
        ingestOk: true,
        sequenceCount: 4,
        frameCount: 100,
      },
      cameraAndLidar,
    );
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
    const result = assessDatasetReadiness(
      {
        isSequence: true,
        ingestOk: true,
        issues: [],
        sequenceCount: 0,
        frameCount: 0,
        itemCount: 0,
        sequences: [],
      },
      cameraAndLidar,
    );
    const lidar = result.checks.find(
      (check) => check.key === "lidar_calibration",
    );
    expect(lidar?.status).toBe("skipped");
    expect(result.blockingReasons).toEqual(["has_sequences", "has_frames"]);
  });
});
