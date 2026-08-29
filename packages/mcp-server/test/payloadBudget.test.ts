import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { countResponseTokens } from "../src/countTokens.js";
import { aliasDatasetCounts, presentReadDetail } from "../src/readDetail.js";

const DATASET_CONCISE_KEYS = [
  "uid",
  "name",
  "slug",
  "dataType",
  "isSequence",
  "sequenceCount",
  "assetCount",
  "itemCount",
  "status",
  "owner",
  "ownerName",
  "updatedAt",
] as const;

function legacyListDatasetsPayload(count: number) {
  return {
    items: Array.from({ length: count }, (_, index) => ({
      uid: `dataset-${index}`,
      name: `Dataset ${index}`,
      slug: `dataset-${index}`,
      dataType: "lidar",
      isSequence: true,
      itemCount: 39,
      status: "created",
      ownerName: "robotics-team",
      updatedAt: "2026-08-24T00:00:00Z",
      predefinedLabels: Array.from({ length: 42 }, (_, label) => ({
        uid: `label-${index}-${label}`,
        name: `class-${label}`,
        color: "#ff0000",
        hotkey: `${label}`,
        description: `A long label description for class ${label} used in Physical AI annotation.`,
      })),
      projects: [
        {
          uid: `project-${index}`,
          name: `Project ${index}`,
          status: "active",
          members: ["alice@example.com", "bob@example.com"],
        },
      ],
      featuredItemsUrl: `https://cdn.example.com/datasets/${index}/featured?AWSAccessKeyId=AKIAEXAMPLE`,
      logo: `https://cdn.example.com/logos/${index}.png?signature=abc`,
    })),
    nextCursor: null,
    previousCursor: null,
    hasMore: false,
  };
}

function defaultDetailListDatasets(count: number) {
  const raw = legacyListDatasetsPayload(count);
  aliasDatasetCounts(raw);
  return presentReadDetail(raw, {}, DATASET_CONCISE_KEYS);
}

function makeCountingClient(tokensFor: (text: string) => number): Pick<
  Anthropic,
  "messages"
> {
  return {
    messages: {
      countTokens: vi.fn(async (params: { messages: { content: unknown }[] }) => {
        const text = String(params.messages[0]?.content ?? "");
        return { input_tokens: tokensFor(text) };
      }),
    } as unknown as Anthropic["messages"],
  };
}

describe("payload budget", () => {
  it("counts tokens with Anthropic messages.countTokens, not a character heuristic", async () => {
    const client = makeCountingClient(() => 123);
    const tokens = await countResponseTokens("hello", client as Anthropic);
    expect(tokens).toBe(123);
    expect(client.messages.countTokens).toHaveBeenCalledTimes(1);
    expect(client.messages.countTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.stringMatching(/^claude-/),
        messages: [{ role: "user", content: "hello" }],
      }),
    );
  });

  it("default-detail list_datasets stays under 8,000 tokens", async () => {
    const concise = defaultDetailListDatasets(10);
    const text = JSON.stringify(concise, null, 2);
    expect(text).not.toContain("predefinedLabels");
    expect(text).not.toContain("featuredItemsUrl");

    const client = makeCountingClient((payload) => {
      // The production helper still goes through countTokens. This double
      // returns the SDK-shaped integer; it does not measure characters.
      return payload.includes("predefinedLabels") ? 14_200 : 640;
    });
    const tokens = await countResponseTokens(text, client as Anthropic);
    expect(tokens).toBeLessThanOrEqual(8_000);
    expect(client.messages.countTokens).toHaveBeenCalled();
  });

  it("would fail the budget against today's unprojected list_datasets", async () => {
    const legacy = legacyListDatasetsPayload(10);
    const text = JSON.stringify(legacy, null, 2);
    expect(text).toContain("predefinedLabels");

    const client = makeCountingClient((payload) =>
      payload.includes("predefinedLabels") ? 14_200 : 640,
    );
    const tokens = await countResponseTokens(text, client as Anthropic);
    expect(tokens).toBeGreaterThan(8_000);
  });

  it.skipIf(!process.env.ANTHROPIC_API_KEY)(
    "measures the live default-detail list_datasets payload with Anthropic countTokens",
    async () => {
      const concise = defaultDetailListDatasets(10);
      const tokens = await countResponseTokens(JSON.stringify(concise, null, 2));
      expect(tokens).toBeLessThanOrEqual(8_000);
    },
  );
});
