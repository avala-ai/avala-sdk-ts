import { describe, it, expect, vi, afterEach } from "vitest";
import { Avala } from "../../src/client.js";

describe("slices resource", () => {
  const mockSlice = {
    uid: "slice-uid-001",
    name: "My Slice",
    slug: "my-slice",
    owner_name: "acme-corp",
    organization: null,
    visibility: "private",
    status: "ready",
    item_count: 50,
    sub_slices: [],
    source_data: null,
    featured_slice_item_urls: ["https://example.com/thumb1.jpg"],
  };

  const mockListResponse = {
    results: [mockSlice],
    next: null,
    previous: null,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists slices for an owner", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve(mockListResponse),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const page = await avala.slices.list("acme-corp");

    expect(page.items).toHaveLength(1);
    expect(page.items[0].name).toBe("My Slice");
    expect(page.items[0].ownerName).toBe("acme-corp");
    expect(page.items[0].itemCount).toBe(50);
    expect(page.hasMore).toBe(false);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain("/slices/acme-corp/list/");
  });

  it("gets a single slice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve(mockSlice),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const slice = await avala.slices.get("acme-corp", "my-slice");

    expect(slice.uid).toBe("slice-uid-001");
    expect(slice.name).toBe("My Slice");
    expect(slice.slug).toBe("my-slice");
    expect(slice.visibility).toBe("private");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain("/slices/acme-corp/my-slice/");
  });

  it("creates a slice with snake_case body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers(),
        json: () => Promise.resolve(mockSlice),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const slice = await avala.slices.create({
      name: "My Slice",
      visibility: "private",
      subSlices: [{ type: "dataset", dataset_uid: "ds-uid-001" }],
    });

    expect(slice.name).toBe("My Slice");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.name).toBe("My Slice");
    expect(body.sub_slices).toEqual([{ type: "dataset", dataset_uid: "ds-uid-001" }]);
    expect(body.visibility).toBe("private");
  });

  it("lists slice items", async () => {
    const mockSliceItem = {
      uid: "item-uid-001",
      key: "image_001.jpg",
      dataset: "ds-uid-001",
      url: "https://example.com/image_001.jpg",
      thumbnails: ["https://example.com/thumb_001.jpg"],
      metadata: { width: 1920, height: 1080 },
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ results: [mockSliceItem], next: null, previous: null }),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const page = await avala.slices.listItems("acme-corp", "my-slice");

    expect(page.items).toHaveLength(1);
    expect(page.items[0].key).toBe("image_001.jpg");
    expect(page.items[0].url).toBe("https://example.com/image_001.jpg");
    expect(page.hasMore).toBe(false);

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain("/slices/acme-corp/my-slice/items/list/");
  });

  it("gets a single slice item", async () => {
    const mockSliceItem = {
      uid: "item-uid-001",
      key: "image_001.jpg",
      dataset: "ds-uid-001",
      url: "https://example.com/image_001.jpg",
      thumbnails: [],
      metadata: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve(mockSliceItem),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const item = await avala.slices.getItem("acme-corp", "my-slice", "item-uid-001");

    expect(item.uid).toBe("item-uid-001");
    expect(item.key).toBe("image_001.jpg");

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain("/slices/acme-corp/my-slice/items/item-uid-001/");
  });
});
