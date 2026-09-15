import { Avala } from "@avala-ai/sdk";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAvalaMcpServer } from "../src/server.js";
import earningsFixture from "./fixtures/billing-earnings.json" with { type: "json" };
import organizationsFixture from "./fixtures/billing-organizations.json" with { type: "json" };

const window = {
  periodEndedFrom: "2026-09-08T12:00:00Z",
  periodEndedBefore: "2026-09-09T12:00:00Z",
};
const earningsName = "get_billing_coworker_earnings";
const orgName = "list_billing_organizations";
const sessions: { close(): Promise<void> }[] = [];

async function setup(
  payload: unknown = earningsFixture,
  scope = "billing.read",
  staff = true,
  status = 200,
) {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const api = new Avala({
    accessToken: "synthetic-billing-test",
    baseUrl: "https://fixture.invalid/api/v1",
  });
  const server = createAvalaMcpServer(() => api, {
    allowMutations: false,
    credentialGrant: {
      isStaffPrivileged: staff,
      scopes: new Set([scope]),
      toolsets: new Set(["staff"]),
    },
  });
  const client = new Client({ name: "billing-test", version: "1.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  sessions.push({
    close: async () => {
      await client.close();
      await server.close();
    },
  });
  return {
    client,
    fetch,
    call: (args: Record<string, unknown> = window, name = earningsName) =>
      client.callTool({ name, arguments: args }),
  };
}

afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close();
  vi.unstubAllGlobals();
});

describe("billing MCP evidence", () => {
  it("preserves decimal money, millisecond units and unknown coverage through real MCP and SDK transports", async () => {
    const { call, fetch } = await setup();
    const result = await call();
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      currencies: [
        { currency: "USD", recordedAmount: "42.35", workedTimeMs: 7200000 },
      ],
      coverage: { excludedRecords: 1 },
      measurement: {
        settlementVerification: "unavailable",
        pendingEstimatesIncluded: false,
      },
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const requested = new URL(url);
    expect(requested.pathname).toBe("/api/v1/admin/billing/coworker-earnings/");
    expect(requested.searchParams.get("period_ended_before")).toBe(
      window.periodEndedBefore,
    );
    expect(requested.searchParams.get("limit")).toBe("25");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("preserves large decimal strings without converting money to JavaScript numbers", async () => {
    const payload = structuredClone(earningsFixture);
    payload.currencies[0]!.recorded_amount = "9007199254740993.99";
    const result = await (await setup(payload)).call();
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      currencies: [{ recordedAmount: "9007199254740993.99" }],
    });
  });

  it.each([
    ["workforce.read", true],
    ["organizations.read", true],
    ["billing.read", false],
  ])(
    "hides financial tools for scope=%s staff=%s including direct calls",
    async (scope, staff) => {
      const { client, call, fetch } = await setup(
        earningsFixture,
        scope,
        staff,
      );
      expect(
        (await client.listTools()).tools.map((tool) => tool.name),
      ).not.toContain(earningsName);
      await expect(call()).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([403, 404])("keeps upstream %s denial an error", async (status) => {
    const { call } = await setup(
      { detail: "Denied" },
      "billing.read",
      true,
      status,
    );
    expect((await call()).isError).toBe(true);
  });

  it.each([
    { ...window, limit: 51 },
    { ...window, periodEndedFrom: "2026-09-01" },
    { ...window, periodEndedBefore: "2026-02-30T00:00:00Z" },
    { ...window, periodEndedBefore: "2099-01-01T00:00:00Z" },
    { ...window, periodEndedFrom: "2026-01-01T00:00:00Z" },
    { ...window, currencyCursor: "XXX" },
    { ...window, includeBankAccount: true },
  ])("rejects invalid inputs before any HTTP call: %j", async (args) => {
    const { call, fetch } = await setup();
    expect((await call(args)).isError).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    (p: typeof earningsFixture) => {
      p.currencies[0]!.recorded_amount = "NaN";
    },
    (p: typeof earningsFixture) => {
      p.currencies[0]!.recorded_amount = "9007199254740993.99";
      p.currencies[0]!.record_count = 3;
    },
    (p: typeof earningsFixture) => {
      p.coverage.excluded_records = 0;
    },
    (p: typeof earningsFixture) => {
      p.currencies[0]!.approved_worked_time_ms = 9000000;
    },
    (p: typeof earningsFixture) => {
      p.measurement.pending_estimates_included = true;
    },
    (p: typeof earningsFixture) => {
      p.measurement.period_ended_before = "2026-09-07T12:00:00Z";
    },
    (p: typeof earningsFixture) => {
      Object.assign(p.currencies[0]!, { bank_account: "private" });
    },
    (p: typeof earningsFixture) => {
      p.has_more = true;
    },
  ])("rejects malformed, private or unsupported evidence", async (mutate) => {
    const payload = structuredClone(earningsFixture);
    mutate(payload);
    expect((await (await setup(payload)).call()).isError).toBe(true);
  });

  it("binds the exact coworker and currency cursor to returned evidence", async () => {
    const { call } = await setup();
    expect(
      (
        await call({
          ...window,
          coworkerUid: "10000000000040008000000000000001",
        })
      ).isError,
    ).toBe(true);
    expect((await call({ ...window, currencyCursor: "USD" })).isError).toBe(
      true,
    );
  });

  it("preserves missing billing state and enforces exact organization and page boundaries", async () => {
    const { call } = await setup(organizationsFixture);
    const result = await call({}, orgName);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      organizations: [
        { subscriptionStatus: "past_due" },
        { billingRecordStatus: "missing", subscriptionStatus: null },
      ],
    });
    expect(
      (
        await call(
          { organizationUid: "10000000000040008000000000000001" },
          orgName,
        )
      ).isError,
    ).toBe(true);
    expect((await call({ limit: 1 }, orgName)).isError).toBe(true);
    expect(
      (await call({ cursor: "20000000000040008000000000000001" }, orgName))
        .isError,
    ).toBe(true);
  });
});
