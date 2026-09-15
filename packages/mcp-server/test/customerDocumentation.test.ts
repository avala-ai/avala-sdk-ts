import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  generateCustomerDocumentation,
  internalToolsInCustomerDocumentation,
} from "../scripts/generate-mcp-docs.js";

const customerPage = new URL(
  "../../../../../docs/integrations/mcp-setup.mdx",
  import.meta.url,
);

describe("customer MCP documentation boundary", () => {
  it("generates customer tools while excluding every registered internal tool", () => {
    const generated = generateCustomerDocumentation();
    expect(generated).toContain("### list_datasets");
    expect(generated).toContain("### create_export");
    expect(internalToolsInCustomerDocumentation(generated)).toEqual([]);
    for (const internal of [
      "get_billing_coworker_earnings",
      "get_workforce_session_monitoring",
      "get_workforce_station_monitoring",
      "create_operation_proposal",
      "staff_query",
    ]) {
      expect(
        internalToolsInCustomerDocumentation(`Recipe: call ${internal}.`),
      ).toEqual([internal]);
      expect(generated).not.toContain(internal);
    }
  });

  it("retains internal tools in the full inventory independently of public generation", () => {
    const inventory = readFileSync(
      new URL("../docs/tool-inventory.md", import.meta.url),
      "utf8",
    );
    expect(internalToolsInCustomerDocumentation(inventory)).toEqual(
      expect.arrayContaining([
        "get_billing_coworker_earnings",
        "get_workforce_session_monitoring",
        "get_workforce_station_monitoring",
        "create_operation_proposal",
        "staff_query",
      ]),
    );
  });

  it.skipIf(!existsSync(customerPage))(
    "never advertises credential-bearing inputs in any setup locale",
    () => {
      for (const locale of ["", "de/", "es/", "fr/", "ja/", "ko/", "ru/", "zh/"]) {
        const page = new URL(
          `../../../../../docs/${locale}integrations/mcp-setup.mdx`,
          import.meta.url,
        );
        const forbiddenInput = readFileSync(page, "utf8").match(
          /^- `(?:providerConfig|s3AccessKeyId|s3SecretAccessKey|gcStorageAuthJsonContent)`/m,
        );
        expect(forbiddenInput, `Unsupported secret input in ${locale || "en/"}`).toBeNull();
      }
    },
  );

  it.skipIf(!existsSync(customerPage))(
    "rejects internal tool references anywhere in the actual customer page",
    () => {
      const content = readFileSync(customerPage, "utf8");
      expect(internalToolsInCustomerDocumentation(content)).toEqual([]);
      expect(content).not.toMatch(
        /workforce\.(read|write)|operations\.(proposal|approval|execution|verification)|billing\.read|mcp\.query|django-admin-session/,
      );
    },
  );
});
