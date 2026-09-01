import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  assetIdentityForUrl,
  createAssetHandleService,
} from "../../src/assetHandles.js";
import { registerDatasetTools } from "../../src/tools/datasets.js";

const SIGNED_FRAME_URL =
  "https://bucket.example/frame.jpg" +
  "?X-Amz-Credential=AKIAEXAMPLE&X-Amz-Signature=signature-value";

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}>;

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  return {
    tool: vi.fn(
      (name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
        handlers.set(name, handler);
      },
    ),
    registerTool: vi.fn(
      (name: string, _config: unknown, handler: ToolHandler) => {
        handlers.set(name, handler);
      },
    ),
    getHandler(name: string) {
      return handlers.get(name);
    },
  };
}

function createMockAvala() {
  return {
    transport: {
      requestPage: vi.fn(),
      requestSingle: vi.fn(),
    },
    datasets: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      listSequences: vi.fn(),
      getSequence: vi.fn(),
      getFrame: vi.fn(),
      getCalibration: vi.fn(),
      getHealth: vi.fn(),
    },
    projects: { list: vi.fn(), get: vi.fn() },
    exports: { list: vi.fn(), get: vi.fn(), create: vi.fn() },
    tasks: { list: vi.fn(), get: vi.fn() },
  };
}

describe("dataset tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;
  let assetHandles: ReturnType<typeof createAssetHandleService>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    assetHandles = createAssetHandleService("dataset-tools-test-key");
    registerDatasetTools(
      server as never,
      (() => avala) as never,
      true,
      assetHandles,
    );
  });

  it("list_datasets defaults to concise detail and aliases sequence counts", async () => {
    const mockPage = {
      items: [
        {
          uid: "ds-1",
          name: "sf-lidar",
          slug: "sf-lidar",
          isSequence: true,
          itemCount: 39,
          dataType: "lidar",
          status: "created",
          ownerName: "robotics-team",
          updatedAt: "2026-08-24T00:00:00Z",
          predefinedLabels: [{ name: "car" }, { name: "truck" }],
          projects: [{ uid: "p1" }],
        },
      ],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    };
    avala.transport.requestPage.mockResolvedValue(mockPage);

    const handler = server.getHandler("list_datasets")!;
    const result = await handler({});

    expect(avala.transport.requestPage).toHaveBeenCalledWith("/datasets/", {
      limit: "25",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0]).toMatchObject({
      uid: "ds-1",
      name: "sf-lidar",
      sequenceCount: 39,
      itemCount: 39,
    });
    expect(parsed.items[0]).not.toHaveProperty("predefinedLabels");
    expect(parsed.items[0]).not.toHaveProperty("projects");
    expect(parsed.has_more).toBe(false);
    expect(parsed.next_cursor).toBeNull();
    expect(result.structuredContent).toEqual(parsed);
  });

  it("list_datasets detail=full keeps labels and still aliases counts", async () => {
    avala.transport.requestPage.mockResolvedValue({
      items: [
        {
          uid: "ds-1",
          name: "sf-lidar",
          slug: "sf-lidar",
          isSequence: true,
          itemCount: 39,
          dataType: "lidar",
          predefinedLabels: [{ name: "car" }],
          featuredItemsUrl: [
            "https://bucket.example/featured.jpg?X-Amz-Credential=AKIAEXAMPLE&X-Amz-Signature=featured-signature",
          ],
          logo:
            "https://bucket.example/logo.png?X-Amz-Credential=AKIAEXAMPLE&X-Amz-Signature=signature-value",
        },
      ],
      nextCursor: "page-2",
      previousCursor: null,
      hasMore: true,
    });

    const handler = server.getHandler("list_datasets")!;
    const result = await handler({ detail: "full", limit: 5 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0].predefinedLabels).toEqual([{ name: "car" }]);
    expect(parsed.items[0]).not.toHaveProperty("logo");
    expect(parsed.items[0].logoAsset.handle).toMatch(/^ah_/);
    expect(parsed.items[0]).not.toHaveProperty("featuredItemsUrl");
    expect(parsed.items[0].featuredItemsAsset[0].handle).toMatch(/^ah_/);
    expect(
      assetHandles.open(parsed.items[0].featuredItemsAsset[0].handle),
    ).toMatchObject({
      kind: "dataset_featured_asset",
      uid: "ds-1",
    });
    expect(result.content[0].text).not.toContain("X-Amz-");
    expect(parsed.items[0].sequenceCount).toBe(39);
    expect(parsed.next_cursor).toBe("page-2");
    expect(avala.transport.requestPage).toHaveBeenCalledWith("/datasets/", {
      limit: "5",
    });
  });

  it("list_datasets passes limit and cursor", async () => {
    avala.transport.requestPage.mockResolvedValue({
      items: [],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    });

    const handler = server.getHandler("list_datasets")!;
    await handler({ limit: 5, cursor: "abc" });

    expect(avala.transport.requestPage).toHaveBeenCalledWith("/datasets/", {
      limit: "5",
      cursor: "abc",
    });
  });

  it("get_dataset aliases non-sequence itemCount to assetCount", async () => {
    avala.transport.requestSingle.mockResolvedValue({
      uid: "ds-1",
      name: "bags",
      slug: "bags",
      isSequence: false,
      itemCount: 100,
      dataType: "image",
      predefinedLabels: [{ name: "bag" }],
    });

    const handler = server.getHandler("get_dataset")!;
    const result = await handler({ uid: "ds-1" });
    const parsed = JSON.parse(result.content[0].text);
    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/datasets/ds-1/",
    );
    expect(parsed.assetCount).toBe(100);
    expect(parsed.itemCount).toBe(100);
    expect(parsed).not.toHaveProperty("predefinedLabels");
  });

  it("preview_curation_candidates sends one bounded request and strips undeclared fields", async () => {
    avala.transport.requestSingle.mockResolvedValue({
      datasetUid: "00000000000000000000000000000001",
      unit: "dataset_item",
      criterion: {
        dimension: "result_status",
        requiredState: "accepted",
        minimumConsensus: null,
        projectUid: "00000000000000000000000000000002",
        taskName: "box",
        deliverableId: null,
        deliverableStateField: null,
        evidenceStatus: "available",
        operatorIdentity: { username: "must-not-leak" },
      },
      candidateUids: ["00000000000000000000000000000003"],
      counts: {
        selected: 1,
        excludedByMembership: 2,
        missingQcEvidence: 3,
        rejectedByThreshold: 4,
        userUids: ["must-not-leak"],
      },
      hasMore: true,
      nextCursor: "signed-cursor",
      limitations: [],
      coworkerAttribution: { username: "must-not-leak" },
    });

    const result = await server.getHandler("preview_curation_candidates")!({
      datasetUid: "00000000-0000-0000-0000-000000000001",
      unit: "dataset_item",
      qcDimension: "result_status",
      requiredState: "accepted",
      projectUid: "00000000-0000-0000-0000-000000000002",
      taskName: "box",
      excludeSliceUid: "00000000-0000-0000-0000-000000000004",
      limit: 10,
      cursor: "previous-cursor",
    });

    expect(avala.transport.requestSingle).toHaveBeenCalledTimes(1);
    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/datasets/00000000-0000-0000-0000-000000000001/curation-preview/",
      {
        unit: "dataset_item",
        qc_dimension: "result_status",
        required_state: "accepted",
        project_uid: "00000000-0000-0000-0000-000000000002",
        task_name: "box",
        exclude_slice_uid: "00000000-0000-0000-0000-000000000004",
        limit: "10",
        cursor: "previous-cursor",
      },
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({
      datasetUid: "00000000000000000000000000000001",
      unit: "dataset_item",
      criterion: {
        dimension: "result_status",
        requiredState: "accepted",
        minimumConsensus: null,
        projectUid: "00000000000000000000000000000002",
        taskName: "box",
        deliverableId: null,
        deliverableStateField: null,
        evidenceStatus: "available",
      },
      candidateUids: ["00000000000000000000000000000003"],
      counts: {
        selected: 1,
        excludedByMembership: 2,
        missingQcEvidence: 3,
        rejectedByThreshold: 4,
      },
      hasMore: true,
      nextCursor: "signed-cursor",
      limitations: [],
    });
    expect(result.structuredContent).toEqual(parsed);
    expect(result.content[0].text).not.toContain("username");
  });

  it("preview_curation_candidates defaults the bounded page and rejects malformed evidence", async () => {
    avala.transport.requestSingle.mockResolvedValue({
      datasetUid: "00000000000000000000000000000001",
      unit: "sequence",
      criterion: {
        dimension: "sequence_workflow",
        requiredState: "customer_approved",
        minimumConsensus: null,
        projectUid: null,
        taskName: null,
        deliverableId: null,
        deliverableStateField: null,
        evidenceStatus: "available",
      },
      candidateUids: [],
      counts: {
        selected: -1,
        excludedByMembership: 0,
        missingQcEvidence: 0,
        rejectedByThreshold: 0,
      },
      hasMore: false,
      nextCursor: null,
      limitations: [],
    });

    await expect(
      server.getHandler("preview_curation_candidates")!({
        datasetUid: "00000000-0000-0000-0000-000000000001",
        unit: "sequence",
        qcDimension: "sequence_workflow",
        requiredState: "customer_approved",
      }),
    ).rejects.toThrow();
    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/datasets/00000000-0000-0000-0000-000000000001/curation-preview/",
      {
        unit: "sequence",
        qc_dimension: "sequence_workflow",
        required_state: "customer_approved",
        limit: "25",
      },
    );
  });

  it.each([
    ["a non-UUID candidate", ["not-a-uuid"]],
    [
      "more than 100 candidates",
      Array.from({ length: 101 }, (_, index) =>
        index.toString(16).padStart(32, "0"),
      ),
    ],
  ])("preview_curation_candidates rejects %s", async (_case, candidateUids) => {
    avala.transport.requestSingle.mockResolvedValue({
      datasetUid: "00000000000000000000000000000001",
      unit: "sequence",
      criterion: {
        dimension: "sequence_workflow",
        requiredState: "customer_approved",
        minimumConsensus: null,
        projectUid: null,
        taskName: null,
        deliverableId: null,
        deliverableStateField: null,
        evidenceStatus: "available",
      },
      candidateUids,
      counts: {
        selected: candidateUids.length,
        excludedByMembership: 0,
        missingQcEvidence: 0,
        rejectedByThreshold: 0,
      },
      hasMore: false,
      nextCursor: null,
      limitations: [],
    });

    await expect(
      server.getHandler("preview_curation_candidates")!({
        datasetUid: "00000000-0000-0000-0000-000000000001",
        unit: "sequence",
        qcDimension: "sequence_workflow",
        requiredState: "customer_approved",
      }),
    ).rejects.toThrow();
  });

  it("create_dataset calls avala.datasets.create and returns JSON", async () => {
    const mockDataset = {
      uid: "new-ds",
      name: "New Dataset",
      slug: "new-dataset",
      dataType: "lidar",
      itemCount: 0,
    };
    avala.datasets.create.mockResolvedValue(mockDataset);

    const handler = server.getHandler("create_dataset")!;
    const result = await handler({
      name: "New Dataset",
      slug: "new-dataset",
      dataType: "lidar",
      visibility: "private",
    });

    expect(avala.datasets.create).toHaveBeenCalledWith({
      name: "New Dataset",
      slug: "new-dataset",
      dataType: "lidar",
      visibility: "private",
      createMetadata: undefined,
      providerConfig: undefined,
      ownerName: undefined,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.uid).toBe("new-ds");
    expect(parsed.name).toBe("New Dataset");
  });

  it("create_dataset passes provider config and owner", async () => {
    avala.datasets.create.mockResolvedValue({
      uid: "s3-ds",
      name: "S3 Dataset",
      slug: "s3-dataset",
      dataType: "image",
      itemCount: 0,
    });

    const handler = server.getHandler("create_dataset")!;
    await handler({
      name: "S3 Dataset",
      slug: "s3-dataset",
      dataType: "image",
      providerConfig: { provider: "aws_s3", s3_bucket_name: "my-bucket" },
      ownerName: "my-org",
    });

    expect(avala.datasets.create).toHaveBeenCalledWith(
      expect.objectContaining({
        providerConfig: { provider: "aws_s3", s3_bucket_name: "my-bucket" },
        ownerName: "my-org",
      }),
    );
  });

  it("list_sequences aliases numberOfFrames to frameCount", async () => {
    avala.transport.requestPage.mockResolvedValue({
      items: [
        {
          uid: "seq-1",
          customUuid: null,
          key: "full-scene-569",
          status: "completed",
          featuredImage: "https://cdn.example/feat.png",
          numberOfFrames: 569,
        },
      ],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    });

    const result = await server.getHandler("list_sequences")!({
      owner: "thirddimension",
      slug: "third-dimension-095940-full-scene",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.items[0]).toMatchObject({
      uid: "seq-1",
      frameCount: 569,
      numberOfFrames: 569,
    });
    expect(parsed.items[0]).not.toHaveProperty("featuredImage");

    const full = await server.getHandler("list_sequences")!({
      owner: "thirddimension",
      slug: "third-dimension-095940-full-scene",
      detail: "full",
    });
    const fullPayload = JSON.parse(full.content[0].text);
    expect(fullPayload.items[0]).not.toHaveProperty("featuredImage");
    expect(fullPayload.items[0].featuredImageAsset.handle).toMatch(/^ah_/);
    expect(
      assetHandles.open(fullPayload.items[0].featuredImageAsset.handle),
    ).toEqual({
      kind: "sequence_featured_asset",
      owner: "thirddimension",
      slug: "third-dimension-095940-full-scene",
      sequenceUid: "seq-1",
      limit: 25,
      identity: assetIdentityForUrl("https://cdn.example/feat.png"),
    });
    expect(full.content[0].text).not.toContain("https://cdn.example/feat.png");
  });

  it("get_sequence omits frames and labels unless detail=full", async () => {
    avala.transport.requestSingle.mockResolvedValue({
      uid: "seq-1",
      key: "full-scene-569",
      status: "completed",
      predefinedLabels: [{ name: "car" }],
      frames: [
        {
          uid: "frame-uid-0",
          idx: 0,
          images: [
            {
              imageUrl: SIGNED_FRAME_URL,
            },
          ],
          exportSnippet: {
            results: [
              {
                items: [
                  {
                    object: "car",
                    data: {
                      Annotator: "customer-defined annotation field",
                    },
                    Annotator: { name: "Jane Operator", userId: "user-1" },
                    Reviewer: { name: "Rae Reviewer", userId: "reviewer-1" },
                  },
                ],
              },
            ],
          },
        },
      ],
      metrics: null,
      datasetUid: "ds-1",
      allowLidarCalibration: false,
      lidarCalibrationEnabled: false,
      cameraCalibrationEnabled: false,
      cropData: null,
    });

    const concise = await server.getHandler("get_sequence")!({
      owner: "thirddimension",
      slug: "third-dimension-095940-full-scene",
      sequenceUid: "seq-1",
    });
    expect(JSON.parse(concise.content[0].text)).not.toHaveProperty("frames");

    const full = await server.getHandler("get_sequence")!({
      owner: "thirddimension",
      slug: "third-dimension-095940-full-scene",
      sequenceUid: "seq-1",
      detail: "full",
    });
    expect(JSON.parse(full.content[0].text).frames).toEqual([
      {
        uid: "frame-uid-0",
        idx: 0,
        images: [
          {
            imageAsset: {
              handle: expect.stringMatching(/^ah_/),
            },
          },
        ],
        exportSnippet: {
          results: [
            {
              items: [
                {
                  object: "car",
                  data: {
                    Annotator: "customer-defined annotation field",
                  },
                },
              ],
            },
          ],
        },
      },
    ]);
    expect(full.content[0].text).not.toContain("Jane Operator");
    expect(full.content[0].text).not.toContain("Rae Reviewer");
    expect(full.content[0].text).not.toContain("X-Amz-");
    expect(
      assetHandles.open(
        JSON.parse(full.content[0].text).frames[0].images[0].imageAsset.handle,
      ),
    ).toEqual({
      kind: "sequence_frame_asset",
      owner: "thirddimension",
      slug: "third-dimension-095940-full-scene",
      sequenceUid: "seq-1",
      frameUid: "frame-uid-0",
      identity: assetIdentityForUrl(SIGNED_FRAME_URL),
      path: ["images", 0, "imageUrl"],
    });
  });

  it("get_frame minimizes detail and gates export attribution", async () => {
    avala.datasets.getFrame.mockResolvedValue({
      frameIndex: 0,
      model: "pinhole",
      key: "frame-0.json",
      images: [
        {
          imageUrl: SIGNED_FRAME_URL,
          fx: 824.74,
          fy: 834.49,
        },
      ],
      raw: {
        uid: "frame-uid-0",
        exportSnippet: {
          annotator: "Frame Annotator",
          reviewerEmail: "reviewer@example.com",
          username: "+254700000001",
          results: [
            {
              items: [
                {
                  object: "car",
                  data: {
                    Annotator: "customer-defined annotation field",
                  },
                  Annotator: {
                    name: "Jane Operator",
                    userId: "user-1",
                    userName: "+254700000001",
                  },
                  Reviewer: {
                    name: "Rae Reviewer",
                    userId: "reviewer-1",
                    userName: "+254700000002",
                  },
                },
              ],
            },
          ],
        },
      },
    });

    const concise = await server.getHandler("get_frame")!({
      owner: "thirddimension",
      slug: "third-dimension-095940-full-scene",
      sequenceUid: "seq-1",
      frameIdx: 0,
    });
    expect(JSON.parse(concise.content[0].text)).toEqual({
      frameIndex: 0,
      model: "pinhole",
      key: "frame-0.json",
    });

    const full = await server.getHandler("get_frame")!({
      owner: "thirddimension",
      slug: "third-dimension-095940-full-scene",
      sequenceUid: "seq-1",
      frameIdx: 0,
      detail: "full",
    });
    const fullPayload = JSON.parse(full.content[0].text);
    expect(fullPayload.images[0].fx).toBe(824.74);
    expect(fullPayload.images[0]).not.toHaveProperty("imageUrl");
    expect(fullPayload.images[0].imageAsset.handle).toMatch(/^ah_/);
    expect(assetHandles.open(fullPayload.images[0].imageAsset.handle)).toEqual({
      kind: "frame_asset",
      owner: "thirddimension",
      slug: "third-dimension-095940-full-scene",
      sequenceUid: "seq-1",
      frameUid: "frame-uid-0",
      identity: assetIdentityForUrl(SIGNED_FRAME_URL),
      path: ["images", 0, "imageUrl"],
    });
    expect(full.content[0].text).not.toContain("X-Amz-");
    expect(fullPayload.raw.exportSnippet.results[0].items[0]).toEqual({
      object: "car",
      data: { Annotator: "customer-defined annotation field" },
    });
    expect(fullPayload.raw.exportSnippet).not.toHaveProperty("username");
    expect(full.content[0].text).not.toContain("Jane Operator");
    expect(full.content[0].text).not.toContain("Rae Reviewer");

    const attributed = await server.getHandler("get_frame")!({
      owner: "thirddimension",
      slug: "third-dimension-095940-full-scene",
      sequenceUid: "seq-1",
      frameIdx: 0,
      include_attribution: true,
      detail: "full",
    });
    const attributedPayload = JSON.parse(attributed.content[0].text);
    expect(
      attributedPayload.raw.exportSnippet.results[0].items[0].Annotator,
    ).toMatchObject({ name: "Jane Operator", userId: "user-1" });
    expect(
      attributedPayload.raw.exportSnippet.results[0].items[0].Reviewer,
    ).toMatchObject({ name: "Rae Reviewer", userId: "reviewer-1" });
    expect(attributedPayload.raw.exportSnippet.annotator).toBe(
      "Frame Annotator",
    );
  });

  it("get_calibration defaults to sequenceUid", async () => {
    avala.datasets.getCalibration.mockResolvedValue({
      sequenceUid: "seq-1",
      cameras: [{ cameraId: "cam_01", model: "pinhole" }],
    });

    const concise = await server.getHandler("get_calibration")!({
      owner: "thirddimension",
      slug: "third-dimension-095940-full-scene",
      sequenceUid: "seq-1",
    });
    expect(JSON.parse(concise.content[0].text)).toEqual({
      sequenceUid: "seq-1",
    });
  });

  it("get_dataset_health aliases itemCount to frameCount and omits sequences by default", async () => {
    avala.transport.requestSingle.mockResolvedValue({
      datasetUid: "ds-1",
      datasetSlug: "sf-lidar",
      datasetStatus: "created",
      itemCount: 3120,
      sequenceCount: 39,
      totalFrames: 3120,
      s3Prefix: "datasets/sf-lidar",
      gcStoragePrefix: null,
      lastUpdatedAt: "2026-08-24T00:00:00Z",
      ingestOk: true,
      sequences: [
        {
          uid: "seq-1",
          key: "full-scene-80",
          status: "completed",
          frameCount: 80,
          hasLidarCalibration: false,
          hasCameraCalibration: false,
        },
      ],
      issues: [],
    });

    const result = await server.getHandler("get_dataset_health")!({
      owner: "thirddimension",
      slug: "sf-lidar",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.frameCount).toBe(3120);
    expect(parsed.itemCount).toBe(3120);
    expect(parsed.sequenceCount).toBe(39);
    expect(parsed.totalFrames).toBe(3120);
    expect(parsed).not.toHaveProperty("sequences");
    expect(parsed).not.toHaveProperty("s3Prefix");
  });

  it("get_dataset_health aliases non-sequence itemCount to assetCount", async () => {
    avala.transport.requestSingle.mockResolvedValue({
      datasetUid: "ds-video",
      datasetSlug: "walkthrough",
      datasetStatus: "created",
      itemCount: 2,
      sequenceCount: 0,
      totalFrames: 0,
      s3Prefix: null,
      gcStoragePrefix: null,
      lastUpdatedAt: "2026-08-24T00:00:00Z",
      ingestOk: true,
      sequences: [],
      issues: [],
    });

    const result = await server.getHandler("get_dataset_health")!({
      owner: "org",
      slug: "walkthrough",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.assetCount).toBe(2);
    expect(parsed.itemCount).toBe(2);
    expect(parsed.totalFrames).toBe(0);
    expect(parsed).not.toHaveProperty("frameCount");
  });

  it("get_dataset_readiness blocks sf-lidar reconstruction on missing calibration", async () => {
    avala.transport.requestSingle.mockResolvedValue({
      datasetUid: "ds-1",
      datasetSlug: "sf-lidar",
      datasetStatus: "created",
      itemCount: 3120,
      sequenceCount: 39,
      totalFrames: 3120,
      ingestOk: true,
      issues: [],
      sequences: Array.from({ length: 39 }, (_, index) => ({
        uid: `seq-${index + 1}`,
        key: `full-scene-${index}`,
        status: "completed",
        frameCount: 80,
        hasLidarCalibration: false,
        hasCameraCalibration: false,
      })),
    });

    const result = await server.getHandler("get_dataset_readiness")!({
      owner: "thirddimension",
      slug: "sf-lidar",
      requiredCalibrations: ["camera", "lidar"],
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/datasets/thirddimension/sf-lidar/health/",
    );
    expect(parsed).not.toHaveProperty("ready");
    expect(parsed).not.toHaveProperty("score");
    expect(parsed).not.toHaveProperty("ingestOk");
    expect(parsed.purpose).toBe("reconstruction");
    expect(parsed.requiredCalibrations).toEqual(["camera", "lidar"]);
    expect(parsed.blockingReasons).toEqual([
      "lidar_calibration",
      "camera_calibration",
    ]);
    expect(parsed.unmeasured).toEqual([]);
    expect(parsed.summary).toMatch(/blocked/i);
    expect(parsed.summary).toMatch(/LiDAR/i);
    expect(parsed.summary).toMatch(/camera/i);

    const byKey = Object.fromEntries(
      parsed.checks.map((check: { key: string }) => [check.key, check]),
    );
    expect(byKey.ingest.status).toBe("pass");
    expect(byKey.has_sequences.status).toBe("pass");
    expect(byKey.has_frames.status).toBe("pass");
    expect(byKey.lidar_calibration).toMatchObject({
      status: "fail",
      severity: "blocking",
    });
    expect(byKey.camera_calibration).toMatchObject({
      status: "fail",
      severity: "blocking",
    });
    expect(byKey.lidar_calibration.evidence).not.toHaveProperty(
      "missingSequenceUids",
    );
  });

  it("get_dataset_readiness detail=full lists the uncalibrated sequences", async () => {
    avala.transport.requestSingle.mockResolvedValue({
      datasetUid: "ds-1",
      datasetSlug: "sf-lidar",
      ingestOk: true,
      issues: [],
      sequenceCount: 2,
      frameCount: 160,
      sequences: [
        {
          uid: "seq-1",
          hasLidarCalibration: false,
          hasCameraCalibration: false,
        },
        {
          uid: "seq-2",
          hasLidarCalibration: true,
          hasCameraCalibration: false,
        },
      ],
    });

    const result = await server.getHandler("get_dataset_readiness")!({
      owner: "thirddimension",
      slug: "sf-lidar",
      requiredCalibrations: ["camera", "lidar"],
      detail: "full",
    });
    const parsed = JSON.parse(result.content[0].text);
    const lidar = parsed.checks.find(
      (check: { key: string }) => check.key === "lidar_calibration",
    );
    expect(lidar.evidence.missingSequenceUids).toEqual(["seq-1"]);
    expect(parsed.blockingReasons).toEqual([
      "lidar_calibration",
      "camera_calibration",
    ]);
  });

  it("get_dataset_readiness marks omitted calibration flags as insufficient_evidence", async () => {
    avala.transport.requestSingle.mockResolvedValue({
      datasetUid: "ds-1",
      datasetSlug: "mystery",
      ingestOk: true,
      issues: [],
      sequenceCount: 3,
      frameCount: 90,
    });

    const result = await server.getHandler("get_dataset_readiness")!({
      owner: "org",
      slug: "mystery",
      requiredCalibrations: ["camera", "lidar"],
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.blockingReasons).toEqual([]);
    expect(parsed.unmeasured).toEqual([
      "lidar_calibration",
      "camera_calibration",
    ]);
    expect(parsed.summary).toMatch(/could not be measured/);
    expect(parsed).not.toHaveProperty("ready");
  });

  it("get_dataset_readiness does not block a camera-only recipe on absent LiDAR", async () => {
    avala.transport.requestSingle.mockResolvedValue({
      datasetUid: "ds-camera",
      datasetSlug: "camera-only",
      datasetStatus: "created",
      sequenceCount: 1,
      totalFrames: 90,
      ingestOk: true,
      issues: [],
      sequences: [
        {
          uid: "seq-1",
          frameCount: 90,
          hasLidarCalibration: false,
          hasCameraCalibration: true,
        },
      ],
    });

    const result = await server.getHandler("get_dataset_readiness")!({
      owner: "org",
      slug: "camera-only",
      requiredCalibrations: ["camera"],
    });
    const parsed = JSON.parse(result.content[0].text);
    const byKey = Object.fromEntries(
      parsed.checks.map((check: { key: string }) => [check.key, check]),
    );

    expect(byKey.lidar_calibration).toMatchObject({
      status: "skipped",
      evidence: { required: false },
    });
    expect(byKey.camera_calibration.status).toBe("pass");
    expect(parsed.blockingReasons).toEqual([]);
  });

  it("get_dataset_readiness accepts non-sequence video assets for a calibration-free recipe", async () => {
    avala.transport.requestSingle.mockResolvedValue({
      datasetUid: "ds-video",
      datasetSlug: "walkthrough",
      datasetStatus: "created",
      itemCount: 2,
      sequenceCount: 0,
      totalFrames: 0,
      ingestOk: true,
      issues: [],
      sequences: [],
    });

    const result = await server.getHandler("get_dataset_readiness")!({
      owner: "org",
      slug: "walkthrough",
      requiredCalibrations: [],
    });
    const parsed = JSON.parse(result.content[0].text);
    const byKey = Object.fromEntries(
      parsed.checks.map((check: { key: string }) => [check.key, check]),
    );

    expect(parsed).toMatchObject({
      frameCount: 0,
      assetCount: 2,
      blockingReasons: [],
      unmeasured: [],
    });
    expect(byKey.has_sequences.status).toBe("skipped");
    expect(byKey.has_assets).toMatchObject({
      status: "pass",
      evidence: { assetCount: 2 },
    });
    expect(byKey).not.toHaveProperty("has_frames");
  });

  it("list_capture_submissions replaces signed URLs and strips attribution on detail=full", async () => {
    avala.transport.requestPage.mockResolvedValue({
      items: [
        {
          resultUid: "result-1",
          itemUid: "item-1",
          playbackUrl:
            "https://bucket.example/capture.mp4?X-Amz-Credential=AKIAEXAMPLE&X-Amz-Signature=signature-value",
          status: "rejected",
          mediaWidth: 1920,
          mediaHeight: 1080,
          durationS: 12.5,
          audio: true,
          submitter: { uid: "user-1", username: "operator" },
          submittedAt: "2026-08-24T00:00:00Z",
          rejectReason: "wrong_subject",
          rejectNote: "The requested tote is not visible.",
          reviewedBy: { uid: "reviewer-1", username: "reviewer" },
          reviewedAt: "2026-08-24T00:05:00Z",
          episodeUid: null,
          extractionStatus: null,
          channels: null,
          thumbnailUrl:
            "https://bucket.example/thumbnail.jpg?X-Amz-Security-Token=session-token&X-Amz-Signature=signature-value",
          acceptance: {
            machineVerdict: "reject",
            blockingReasons: ["duration_too_short"],
            unmeasured: [],
            evaluatedAt: "2026-08-24T00:01:00Z",
          },
          campaign: {
            uid: "campaign-1",
            name: "Warehouse tote capture",
            taskDescription: {
              spec: "front-view",
              name: "Front view",
              config: {
                captureKind: "video",
                captureTier: "standard",
                camera: "rear",
                durationS: 15,
                audio: true,
                orientation: "landscape",
                clipsPerSession: 2,
                handGuardrail: true,
                handGuardrailMinHands: 2,
                subject: "warehouse tote",
                subjectByLocale: {},
                instructions: "Keep both hands in frame.",
                instructionsByLocale: {},
              },
            },
          },
        },
      ],
      nextCursor: "next-capture",
      previousCursor: null,
      hasMore: true,
    });

    const result = await server.getHandler("list_capture_submissions")!({
      datasetUid: "dataset-1",
      status: "rejected",
      limit: 10,
      cursor: "capture-page",
      detail: "full",
    });

    expect(avala.transport.requestPage).toHaveBeenCalledWith(
      "/datasets/dataset-1/capture-submissions/",
      {
        status: "rejected",
        limit: "10",
        cursor: "capture-page",
      },
    );
    const structured = result.structuredContent as {
      items: Record<string, unknown>[];
    };
    expect(structured.items[0]).not.toHaveProperty("playbackUrl");
    expect(structured.items[0]).not.toHaveProperty("thumbnailUrl");
    expect(
      (structured.items[0].playbackAsset as { handle: string }).handle,
    ).toMatch(/^ah_/);
    expect(
      (structured.items[0].thumbnailAsset as { handle: string }).handle,
    ).toMatch(/^ah_/);
    expect(structured.items[0]).not.toHaveProperty("submitter");
    expect(structured.items[0]).not.toHaveProperty("reviewedBy");
    expect(result.content[0].text).not.toContain("X-Amz-Credential");
    expect(result.content[0].text).not.toContain("operator");
    expect(result.content[0].text).not.toContain("reviewer");
    expect(JSON.parse(result.content[0].text).items[0].campaign.taskDescription.spec).toBe(
      "front-view",
    );
  });

  it("get_capture_submission dispatches the tenant-scoped result route", async () => {
    avala.transport.requestSingle.mockResolvedValue({
      resultUid: "result-1",
      itemUid: "item-1",
      playbackUrl:
        "https://bucket.example/capture.mcap?X-Amz-Credential=AKIAEXAMPLE&X-Amz-Signature=signature-value",
      status: "pending",
      mediaWidth: null,
      mediaHeight: null,
      durationS: null,
      audio: null,
      submitter: { uid: "user-1", username: "operator" },
      submittedAt: "2026-08-24T00:00:00Z",
      rejectReason: null,
      rejectNote: null,
      reviewedBy: null,
      reviewedAt: null,
      episodeUid: "episode-1",
      extractionStatus: "processing",
      channels: [],
      thumbnailUrl:
        "https://bucket.example/thumbnail.jpg?X-Amz-Security-Token=session-token&X-Amz-Signature=signature-value",
      acceptance: null,
      campaign: null,
    });

    const result = await server.getHandler("get_capture_submission")!({
      resultUid: "result-1",
      detail: "full",
    });
    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/results/result-1/capture-submission/",
    );
    expect(result.structuredContent).not.toHaveProperty("playbackUrl");
    expect(
      (result.structuredContent?.playbackAsset as { handle: string }).handle,
    ).toMatch(/^ah_/);
    expect(
      (result.structuredContent?.thumbnailAsset as { handle: string }).handle,
    ).toMatch(/^ah_/);
    expect(result.structuredContent).not.toHaveProperty("submitter");
    expect(result.structuredContent).not.toHaveProperty("reviewedBy");
    expect(result.content[0].text).not.toContain("X-Amz-");
    expect(result.content[0].text).not.toContain("operator");
  });

  it("get_capture_submission returns attribution only when explicitly requested", async () => {
    avala.transport.requestSingle.mockResolvedValue({
      resultUid: "result-1",
      itemUid: "item-1",
      status: "accepted",
      mediaWidth: 1920,
      mediaHeight: 1080,
      durationS: 12.5,
      audio: true,
      submitter: {
        uid: "user-1",
        username: "+254700000001",
        email: "operator@example.com",
      },
      submittedAt: "2026-08-24T00:00:00Z",
      rejectReason: null,
      rejectNote: null,
      reviewedBy: { uid: "reviewer-1", username: "+254700000002" },
      reviewedAt: "2026-08-24T00:05:00Z",
      episodeUid: null,
      extractionStatus: null,
      channels: null,
      acceptance: null,
      campaign: null,
    });

    const result = await server.getHandler("get_capture_submission")!({
      resultUid: "result-1",
      include_attribution: true,
    });

    expect(avala.transport.requestSingle).toHaveBeenCalledWith(
      "/results/result-1/capture-submission/",
    );
    expect(result.structuredContent).toMatchObject({ resultUid: "result-1" });
    expect(
      (result.structuredContent as { submitter: Record<string, unknown> })
        .submitter,
    ).toEqual({ uid: "user-1", username: "+254700000001" });
    expect(
      (result.structuredContent as { reviewedBy: Record<string, unknown> })
        .reviewedBy,
    ).toEqual({ uid: "reviewer-1", username: "+254700000002" });
    expect(result.structuredContent).not.toHaveProperty("mediaWidth");
    expect(result.content[0].text).toContain("+254700000001");
  });

  it("list_capture_campaigns slims config unless detail=full", async () => {
    const progress = {
      totalSlots: 12,
      notRecorded: 3,
      awaitingReview: 2,
      accepted: 5,
      rejected: 1,
      recaptureRequested: 1,
    };
    const campaigns = {
      campaigns: [
        {
          projectUid: "campaign-1",
          name: "Warehouse tote capture",
          status: "active",
          createdAt: "2026-08-24T00:00:00Z",
          finishedAt: null,
          config: {
            captureKind: "video",
            captureTier: "standard",
            camera: "rear",
            durationS: 15,
            audio: true,
            orientation: "landscape",
            clipsPerSession: 2,
            handGuardrail: true,
            handGuardrailMinHands: 2,
            subject: "warehouse tote",
            subjectByLocale: {},
            instructions: "Keep both hands in frame.",
            instructionsByLocale: {},
          },
          progress,
          canManage: true,
          taskDescriptions: [
            {
              spec: "front-view",
              name: "Front view",
              config: {
                captureKind: "video",
                captureTier: "standard",
                camera: "rear",
                durationS: 15,
                audio: true,
                orientation: "landscape",
                clipsPerSession: 2,
                handGuardrail: true,
                handGuardrailMinHands: 2,
                subject: "warehouse tote",
                subjectByLocale: {},
                instructions: "Keep both hands in frame.",
                instructionsByLocale: {},
              },
              progress,
            },
          ],
        },
      ],
      progress,
    };
    avala.transport.requestSingle.mockResolvedValue(campaigns);

    const concise = await server.getHandler("list_capture_campaigns")!({
      datasetUid: "dataset-1",
    });
    const conciseBody = JSON.parse(concise.content[0].text);
    expect(conciseBody.campaigns[0]).toEqual({
      projectUid: "campaign-1",
      name: "Warehouse tote capture",
      status: "active",
      progress,
    });
    expect(conciseBody.campaigns[0]).not.toHaveProperty("config");

    const full = await server.getHandler("list_capture_campaigns")!({
      datasetUid: "dataset-1",
      detail: "full",
    });
    expect(JSON.parse(full.content[0].text).campaigns[0].taskDescriptions[0].progress.accepted).toBe(
      5,
    );
  });

  it("list_capture_campaigns preserves the valid no-campaign state", async () => {
    const empty = {
      campaigns: [],
      progress: {
        totalSlots: 0,
        notRecorded: 0,
        awaitingReview: 0,
        accepted: 0,
        rejected: 0,
        recaptureRequested: 0,
      },
    };
    avala.transport.requestSingle.mockResolvedValue(empty);
    const result = await server.getHandler("list_capture_campaigns")!({
      datasetUid: "dataset-1",
    });
    expect(result.structuredContent).toEqual(empty);
  });

  it("create_dataset is not registered without allowMutations", () => {
    const readOnlyServer = createMockServer();
    registerDatasetTools(readOnlyServer as never, avala as never, false);
    expect(readOnlyServer.getHandler("list_datasets")).toBeDefined();
    expect(readOnlyServer.getHandler("create_dataset")).toBeUndefined();
  });

  it("registers read-only + mutation tools when allowMutations is true", () => {
    expect(server.registerTool).toHaveBeenCalledTimes(13);
    expect(server.getHandler("list_datasets")).toBeDefined();
    expect(server.getHandler("create_dataset")).toBeDefined();
  });
});
