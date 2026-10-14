import { afterEach, describe, expect, it, vi } from "vitest";
import { Avala } from "../src/client.js";
import type { DatasetItem, SliceItem } from "../src/types.js";

// PR #20318's read-only detail field is nullable; list and older responses omit it.
type ItemFingerprint = Pick<DatasetItem, "masksFingerprint"> & Pick<SliceItem, "masksFingerprint">;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(["datasets", "slices"] as const)("%s item fingerprint response compatibility", (resourceName) => {
  it.each(["masks-revision-001", null])("preserves the nullable detail fingerprint %s", async (fingerprint) => {
    // Compile against both public interfaces, including their null contract.
    const expected: ItemFingerprint = { masksFingerprint: fingerprint };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ uid: "item-001", masks_fingerprint: fingerprint }),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const item = await avala[resourceName].getItem("test-org", "test-data", "item-001");

    expect(item.masksFingerprint).toBe(expected.masksFingerprint);
    expect(item).not.toHaveProperty("masks_fingerprint");
  });

  it.each(["detail", "list"] as const)("accepts a %s response without a fingerprint", async (responseShape) => {
    // Both interfaces must also accept older/list objects without this property.
    const expected: ItemFingerprint = {};
    const payload = { uid: "item-001" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => responseShape === "detail" ? payload : { results: [payload], next: null, previous: null },
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const resource = avala[resourceName];
    const item = responseShape === "detail"
      ? await resource.getItem("test-org", "test-data", "item-001")
      : (await resource.listItems("test-org", "test-data")).items[0];

    expect(item.masksFingerprint).toBe(expected.masksFingerprint);
    expect(item).not.toHaveProperty("masksFingerprint");
  });
});
