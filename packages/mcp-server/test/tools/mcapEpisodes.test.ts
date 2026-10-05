import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Avala } from "@avala-ai/sdk";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { registerDatasetTools } from "../../src/tools/datasets.js";
import { mcapEpisodeWire } from "../fixtures/mcap-episode.js";

// Accepted R2 caller contract: MCAP episode identifiers use mcap-episodes,
// independently of DatasetSequence IDs. Django owns visibility and admission.
// Source: dataset/mcap/urls.py, api.py and serializers.py; MCP never calls
// file-url here because that GET can seed ETags and enqueue reprocessing.
describe("MCAP episode metadata caller", () => {
  let server: McpServer;
  let client: Client;
  let fetchMock: ReturnType<typeof vi.fn>;
  const locator = { owner: "robotics-team", slug: "r2-canary" };
  const episode = { ...locator, episodeUid: mcapEpisodeWire.uid };

  beforeEach(async () => {
    fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(mcapEpisodeWire)));
    vi.stubGlobal("fetch", fetchMock);
    const avala = new Avala({ apiKey: "test-key", baseUrl: "https://api.example.test/api/v1" });
    server = new McpServer({ name: "mcap-read-test", version: "1.0.0" });
    registerDatasetTools(server, () => avala, false);
    client = new Client({ name: "mcap-caller-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    vi.unstubAllGlobals();
  });

  it("reads an episode with no sequence relationship using exactly one authenticated GET", async () => {
    const result = await client.callTool({ name: "get_mcap_episode", arguments: episode });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      uid: episode.episodeUid, fileSizeBytes: 8867, durationSeconds: 2,
      messageCount: 3, extractionStatus: "completed", isHidden: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://api.example.test/api/v1/datasets/robotics-team/r2-canary/mcap-episodes/${episode.episodeUid}/`);
    expect(init.method).toBe("GET");
    expect(init.headers["X-Avala-Api-Key"]).toBe("test-key");
    expect(init.redirect).toBe("manual");
  });

  it("allows only declared metadata and topic fields even with full detail", async () => {
    const result = await client.callTool({ name: "get_mcap_episode", arguments: { ...episode, detail: "full" } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      itemUid: null, sequenceUid: null, library: "mcap-test", profile: "ros2",
      topics: [{ topicName: "/camera/image", schemaName: "sensor_msgs/Image", messageEncoding: "cdr", messageCount: 3, panelType: "image" }],
    });
    const output = JSON.stringify(result);
    for (const excluded of ["tenant/private", "storage.example.test", "private-person", "private upstream", "must-not-pass-through", "firstMessageTimeNs", "lastMessageTimeNs"]) {
      expect(output).not.toContain(excluded);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lists the server-selected page without filtering hidden or incomplete rows or following URLs", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      results: [{ ...mcapEpisodeWire, is_hidden: true, extraction_status: "pending", message_count: 0 }],
      next: "https://api.example.test/api/v1/datasets/robotics-team/r2-canary/mcap-episodes/?cursor=next-page",
      previous: null,
      unknown_metadata: "must-not-pass-through",
    })));
    const result = await client.callTool({ name: "list_mcap_episodes", arguments: locator });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      items: [{ uid: episode.episodeUid, isHidden: true, extractionStatus: "pending", messageCount: 0, topicCount: 1 }],
      nextCursor: "next-page", hasMore: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(fetchMock.mock.calls[0][0]).search).toBe("?limit=25");
    expect(JSON.stringify(result)).not.toContain("must-not-pass-through");
  });

  it("passes a caller-selected cursor and bounded limit to the same authenticated list route", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ results: [], next: null, previous: null })));
    const result = await client.callTool({ name: "list_mcap_episodes", arguments: { ...locator, cursor: "next-page", limit: 7 } });
    expect(result.isError).not.toBe(true);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/api/v1/datasets/robotics-team/r2-canary/mcap-episodes/");
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: "7", cursor: "next-page" });
  });

  it.each([403, 404])("propagates HTTP %i without a public, sequence, or file-URL fallback", async (status) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: "private upstream diagnostic" }), { status }));
    const result = await client.callTool({ name: "get_mcap_episode", arguments: episode });
    expect(result.isError).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("private upstream diagnostic");
  });

  it("rejects an oversized list before making any request", async () => {
    const result = await client.callTool({ name: "list_mcap_episodes", arguments: { ...locator, limit: 1001 } });
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps get_sequence on its existing route without an implicit episode retry", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: "Not found" }), { status: 404 }));
    const result = await client.callTool({ name: "get_sequence", arguments: { ...locator, sequenceUid: episode.episodeUid } });
    expect(result.isError).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe(`/api/v1/datasets/robotics-team/r2-canary/sequences/${episode.episodeUid}/`);
  });
});
