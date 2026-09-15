import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GetClient } from "../client.js";
import { defineReadCatalogTool, registerReadCatalogTool } from "../catalog.js";

const uid = z
  .string()
  .regex(
    /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  );
const canonical = (value: string): string =>
  value.replaceAll("-", "").toLowerCase();
const instant = z.iso.datetime({ offset: true });
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const currency = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .refine((value) => value !== "XXX" && value !== "XTS");
const page = { limit: z.number().int().min(1).max(50).default(25) };

const earningsInput = z
  .object({
    ...page,
    periodEndedFrom: instant.describe(
      "Inclusive end-of-recorded-period boundary, with timezone.",
    ),
    periodEndedBefore: instant.describe(
      "Exclusive end-of-recorded-period boundary; past window of at most 31 days.",
    ),
    coworkerUid: uid
      .optional()
      .describe("Exact opaque coworker user UID; omitted means all coworkers."),
    currencyCursor: currency.optional(),
  })
  .strict()
  .refine((value) => {
    const start = Date.parse(value.periodEndedFrom),
      end = Date.parse(value.periodEndedBefore);
    return end > start && end - start <= 31 * 86400000 && end <= Date.now();
  }, "Require a past increasing window of at most 31 days.");

const earningsOutput = z
  .object({
    generatedAt: instant,
    measurement: z
      .object({
        source: z.literal("recorded_coworker_payout"),
        coworkerUid: uid.nullable(),
        periodEndedFrom: instant,
        periodEndedBefore: instant,
        boundary: z.literal("half_open"),
        periodSelection: z.literal("date_to_within_window_full_period_amount"),
        coverageScope: z.literal("filtered_records_all_currency_pages"),
        invalidReasonCountsOverlap: z.literal(true),
        historicalCompleteness: z.literal("unknown"),
        overlappingPeriodsDeduplicated: z.literal(false),
        pendingEstimatesIncluded: z.literal(false),
        settlementVerification: z.literal("unavailable"),
        batchCostAttribution: z.literal("unavailable"),
      })
      .strict(),
    coverage: z
      .object({
        filteredRecords: count,
        includedRecords: count,
        excludedRecords: count,
        invalidPeriodRecords: count,
        invalidAmountRecords: count,
        invalidWorkedTimeRecords: count,
        unknownCurrencyRecords: count,
      })
      .strict(),
    currencies: z
      .array(
        z
          .object({
            currency,
            recordCount: count.min(1),
            recordedAmount: z.string().regex(/^(?:0|[1-9][0-9]*)\.[0-9]{2}$/),
            workedTimeMs: count,
            approvedWorkedTimeMs: count,
          })
          .strict()
          .refine((row) => row.approvedWorkedTimeMs <= row.workedTimeMs),
      )
      .max(50),
    hasMore: z.boolean(),
    nextCurrencyCursor: currency.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const c = value.coverage;
    const reasons = [
      c.invalidPeriodRecords,
      c.invalidAmountRecords,
      c.invalidWorkedTimeRecords,
      c.unknownCurrencyRecords,
    ];
    if (
      c.filteredRecords !== c.includedRecords + c.excludedRecords ||
      reasons.some((n) => n > c.excludedRecords) ||
      reasons.reduce((a, b) => a + b, 0) < c.excludedRecords ||
      value.currencies.reduce((n, row) => n + row.recordCount, 0) >
        c.includedRecords
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Inconsistent recorded-earnings coverage.",
      });
    }
  });

const organizationInput = z
  .object({ ...page, organizationUid: uid.optional(), cursor: uid.optional() })
  .strict();
const organizationOutput = z
  .object({
    generatedAt: instant,
    measurement: z
      .object({
        source: z.literal("stored_organization_billing"),
        providerLiveStatusVerified: z.literal(false),
        invoiceAmountsSupported: z.literal(false),
        settlementVerification: z.literal("unavailable"),
      })
      .strict(),
    organizations: z
      .array(
        z
          .object({
            organizationUid: uid,
            billingRecordStatus: z.enum([
              "present",
              "missing",
              "invalid_status",
            ]),
            subscriptionStatus: z
              .enum(["inactive", "active", "past_due", "canceled", "trialing"])
              .nullable(),
            currentPeriodStart: instant.nullable(),
            currentPeriodEnd: instant.nullable(),
            recordUpdatedAt: instant.nullable(),
          })
          .strict()
          .refine((row) =>
            row.billingRecordStatus === "present"
              ? row.subscriptionStatus !== null
              : row.subscriptionStatus === null,
          )
          .refine(
            (row) =>
              row.billingRecordStatus !== "missing" ||
              [
                row.currentPeriodStart,
                row.currentPeriodEnd,
                row.recordUpdatedAt,
              ].every((value) => value === null),
          ),
      )
      .max(50),
    hasMore: z.boolean(),
    nextCursor: uid.nullable(),
  })
  .strict();

function assertPage(
  ids: string[],
  limit: number,
  cursor: string | undefined,
  hasMore: boolean,
  next: string | null,
): void {
  if (
    ids.length > limit ||
    ids.some((id, index) => id <= (index ? ids[index - 1]! : (cursor ?? ""))) ||
    (hasMore ? ids.length !== limit || next !== ids.at(-1) : next !== null)
  ) {
    throw new Error("Billing response pagination does not match the request.");
  }
}

const earningsTool = defineReadCatalogTool({
  name: "get_billing_coworker_earnings",
  title: "Read recorded coworker earnings",
  description:
    "Read bounded recorded coworker earnings grouped by currency. Staff billing.read required. Select complete payout periods by their date_to in a past half-open window of at most 31 days; amounts are decimal strings, time is milliseconds. Follow currency cursors with unchanged filters. Never combine currencies, sum repeated coverage across pages, infer settled payments, calculate pending earnings or attribute costs to batches. Historical completeness and settlement are unavailable; overlapping records are not deduplicated.",
  inputSchema: earningsInput,
  outputSchema: earningsOutput,
  supportsDetail: false,
  project: (value, _detail, args) => {
    const result = earningsOutput.parse(value),
      request = earningsInput.parse(args);
    if (
      Date.parse(result.measurement.periodEndedFrom) !==
        Date.parse(request.periodEndedFrom) ||
      Date.parse(result.measurement.periodEndedBefore) !==
        Date.parse(request.periodEndedBefore) ||
      (result.measurement.coworkerUid === null
        ? null
        : canonical(result.measurement.coworkerUid)) !==
        (request.coworkerUid ? canonical(request.coworkerUid) : null)
    )
      throw new Error("Billing evidence scope does not match the request.");
    assertPage(
      result.currencies.map((row) => row.currency),
      request.limit,
      request.currencyCursor,
      result.hasMore,
      result.nextCurrencyCursor,
    );
    if (
      !request.currencyCursor &&
      !result.hasMore &&
      result.currencies.reduce((n, row) => n + row.recordCount, 0) !==
        result.coverage.includedRecords
    )
      throw new Error("Complete currency page is missing included records.");
    return result;
  },
  route: {
    name: "billing-coworker-earnings",
    method: "GET",
    path: "/admin/billing/coworker-earnings/",
    query: {
      periodEndedFrom: "period_ended_from",
      periodEndedBefore: "period_ended_before",
      coworkerUid: "coworker_uid",
      currencyCursor: "currency_cursor",
      limit: "limit",
    },
    response: "single",
    scope: "billing.read",
    toolset: "staff",
  },
});

const organizationsTool = defineReadCatalogTool({
  name: "list_billing_organizations",
  title: "Read stored organization billing",
  description:
    "Read bounded opaque organization IDs and stored subscription status with billing.read staff access. Missing or invalid billing records remain unknown. These records are not a live payment-provider check and do not expose invoices, usage charges or settlement. Preserve organization filters across cursor pages.",
  inputSchema: organizationInput,
  outputSchema: organizationOutput,
  supportsDetail: false,
  project: (value, _detail, args) => {
    const result = organizationOutput.parse(value),
      request = organizationInput.parse(args);
    const ids = result.organizations.map((row) =>
      canonical(row.organizationUid),
    );
    assertPage(
      ids,
      request.limit,
      request.cursor && canonical(request.cursor),
      result.hasMore,
      result.nextCursor && canonical(result.nextCursor),
    );
    if (
      request.organizationUid &&
      ids.some((id) => id !== canonical(request.organizationUid!))
    )
      throw new Error("Billing organization does not match the request.");
    return result;
  },
  route: {
    name: "billing-organizations",
    method: "GET",
    path: "/admin/billing/organizations/",
    query: {
      organizationUid: "organization_uid",
      cursor: "cursor",
      limit: "limit",
    },
    response: "single",
    scope: "billing.read",
    toolset: "staff",
  },
});

export const BILLING_READ_CATALOG_TOOLS = [
  earningsTool,
  organizationsTool,
] as const;
export function registerBillingTools(
  server: McpServer,
  getClient: GetClient,
): void {
  registerReadCatalogTool(server, getClient, earningsTool);
  registerReadCatalogTool(server, getClient, organizationsTool);
}
