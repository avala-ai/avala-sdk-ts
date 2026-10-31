import { afterEach, describe, expect, it, vi } from "vitest";
import { Avala } from "../src/client.js";
import type { DatasetSequence } from "../src/types.js";

// DatasetSequenceItemRetrieveSerializer/lidar_r2.discovery supply these detail descriptors.
// The existing SDK transport camelCases nested response keys; no transport exception is needed.
type SequenceDiscovery = Pick<DatasetSequence, "annotationStorage">;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sequence annotation storage response compatibility", () => {
  it.each([
    {
      wire: { provider: "s3", protocol: "lidar-aws-post-v1", ground_upload_supported: true },
      decoded: { provider: "s3", protocol: "lidar-aws-post-v1", groundUploadSupported: true },
    },
    {
      wire: { provider: "r2", protocol: "lidar-r2-v1", ground_upload_supported: false },
      decoded: { provider: "r2", protocol: "lidar-r2-v1", groundUploadSupported: false },
    },
    // Retain the SDK's optional-dictionary null compatibility; current server discovery returns a map.
    { wire: null, decoded: null },
  ])("decodes the existing descriptor $wire", async ({ wire, decoded }) => {
    const expected: SequenceDiscovery = { annotationStorage: decoded };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ uid: "sequence-001", annotation_storage: wire }),
    }));

    const avala = new Avala({ apiKey: "test-key" });
    const sequence = await avala.datasets.getSequence("test-org", "test-data", "sequence-001");

    expect(sequence.annotationStorage).toEqual(expected.annotationStorage);
    expect(sequence).not.toHaveProperty("annotation_storage");
  });

  it.each(["detail", "list"] as const)("accepts an omitted descriptor in %s responses", async (responseShape) => {
    // List/API-key list and older detail responses omit this detail-only field.
    const expected: SequenceDiscovery = {};
    const payload = { uid: "sequence-001" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => responseShape === "detail" ? payload : { results: [payload], next: null, previous: null },
    }));

    const avala = new Avala({ apiKey: "test-key" });
    const sequence = responseShape === "detail"
      ? await avala.datasets.getSequence("test-org", "test-data", "sequence-001")
      : (await avala.datasets.listSequences("test-org", "test-data")).items[0];

    expect(sequence.annotationStorage).toBe(expected.annotationStorage);
    expect(sequence).not.toHaveProperty("annotationStorage");
  });
});
