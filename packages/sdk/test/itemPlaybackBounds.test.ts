import { afterEach, describe, expect, it, vi } from "vitest";
import { Avala } from "../src/client.js";
import type { PlaybackBounds } from "../src/types.js";

afterEach(() => vi.unstubAllGlobals());

describe.each(["datasets", "slices"] as const)("%s item playback bounds", (resource) => {
  it("preserves the optional saved interval returned by DatasetItemSerializer", async () => {
    const bounds: PlaybackBounds = {
      originNs: "0",
      durationNs: 4_125_000_000,
      startOffsetNs: 100_000_000,
      endOffsetNs: 2_000_000_000,
    };
    const responses = [
      { uid: "item" },
      { uid: "item", playback_bounds: null },
      {
        uid: "item",
        playback_bounds: {
          origin_ns: "0",
          duration_ns: 4_125_000_000,
          start_offset_ns: 100_000_000,
          end_offset_ns: 2_000_000_000,
        },
      },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(responses.shift()))));

    const items = new Avala({ apiKey: "test-key" })[resource];
    expect(await items.getItem("org", "data", "item")).not.toHaveProperty("playbackBounds");
    expect((await items.getItem("org", "data", "item")).playbackBounds).toBeNull();
    expect((await items.getItem("org", "data", "item")).playbackBounds).toEqual(bounds);
  });
});
