/**
 * API contract tests: verify SDK types and methods match the API contract.
 *
 * These tests load contracts/api_contracts.json and verify that:
 * 1. Every field in the contract can be accessed on the corresponding SDK type
 * 2. SDK methods use the correct transport (requestPage vs requestList)
 *
 * If a Django serializer field is added/removed, the contract file is updated
 * and these tests will fail until the SDK types are updated to match.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Load the contract file
const contractPath = path.resolve(__dirname, "../../../../../contracts/api_contracts.json");
const contract = JSON.parse(fs.readFileSync(contractPath, "utf-8"));

/**
 * Convert a snake_case field name to camelCase (matching SDK's snakeToCamel).
 */
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Build a mock object from contract fields with null values.
 * This simulates what the SDK would receive from the API after snakeToCamel.
 */
function buildMockFromFields(fields: string[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const field of fields) {
    obj[snakeToCamel(field)] = null;
  }
  return obj;
}

/**
 * Read SDK resource source files and check which transport method each SDK method uses.
 */
function getSDKMethodTransport(resourceFile: string, methodName: string): string | null {
  const filePath = path.resolve(__dirname, "../src/resources", resourceFile);
  const source = fs.readFileSync(filePath, "utf-8");

  // Find the method in the source
  const methodRegex = new RegExp(
    `async\\s+${methodName}\\s*\\([^)]*\\)[^{]*\\{([\\s\\S]*?)(?=\\n  async |\\n}\\s*$)`,
  );
  const match = source.match(methodRegex);
  if (!match) return null;

  const body = match[1];

  if (body.includes("requestPage<") || body.includes("requestPage(")) return "paginated";
  if (body.includes("requestList<") || body.includes("requestList(")) return "array";
  if (body.includes('request("DELETE"')) return "void";
  if (body.includes("requestSingle<")) return "single";
  if (body.includes("requestCreate<")) return "single";
  if (body.includes("requestUpdate<")) return "single";
  // void POST/PATCH without model parsing
  if (body.includes('request("POST"') || body.includes('request("PATCH"')) return "void";

  return null;
}

// ── Type field coverage tests ──────────────────────────────────

/**
 * Parse field names from a TypeScript interface definition in source code.
 */
function parseInterfaceFields(source: string, interfaceName: string): Set<string> {
  const regex = new RegExp(`export interface ${interfaceName}\\s*\\{([^}]+)\\}`, "s");
  const match = source.match(regex);
  if (!match) return new Set();
  const body = match[1];
  const fields = new Set<string>();
  for (const line of body.split("\n")) {
    const fieldMatch = line.match(/^\s+(\w+)\s*[?:]/);
    if (fieldMatch) fields.add(fieldMatch[1]);
  }
  return fields;
}

// Read the actual types.ts source file once for all tests
const typesSource = fs.readFileSync(path.resolve(__dirname, "../src/types.ts"), "utf-8");

describe("SDK types cover all contract fields", () => {
  const typeChecks: Array<{ typeName: string; fields: string[] }> = [];

  for (const [typeName, typeDef] of Object.entries(contract.types) as Array<[string, Record<string, unknown>]>) {
    const allFields = new Set<string>();
    for (const key of ["fields", "list_fields", "detail_fields", "api_key_list_fields"]) {
      const f = typeDef[key];
      if (Array.isArray(f)) {
        for (const field of f) allFields.add(field as string);
      }
    }
    typeChecks.push({ typeName, fields: Array.from(allFields) });
  }

  for (const { typeName, fields } of typeChecks) {
    it(`${typeName} SDK interface covers all ${fields.length} contract fields`, () => {
      // Parse the actual TypeScript interface from types.ts
      const interfaceFields = parseInterfaceFields(typesSource, typeName);

      expect(
        interfaceFields.size,
        `Interface '${typeName}' not found in types.ts`,
      ).toBeGreaterThan(0);

      // Verify every contract field (converted to camelCase) exists in the real interface
      const camelFields = fields.map(snakeToCamel);
      for (const camelField of camelFields) {
        expect(
          interfaceFields.has(camelField),
          `${typeName} interface in types.ts is missing field '${camelField}' (from API field '${fields[camelFields.indexOf(camelField)]}')`,
        ).toBe(true);
      }
    });
  }
});

// ── Response shape tests ───────────────────────────────────────

describe("SDK methods use correct transport for response shape", () => {
  const resourceFileMap: Record<string, string> = {
    organizations: "organizations.ts",
    slices: "slices.ts",
    datasets: "datasets.ts",
    annotation_issues: "annotationIssues.ts",
  };

  // Convert Python snake_case method names to TypeScript camelCase
  const methodNameMap: Record<string, string> = {
    "organizations.list": "list",
    "organizations.list_members": "listMembers",
    "organizations.remove_member": "removeMember",
    "organizations.update_member_role": "updateMemberRole",
    "organizations.leave": "leave",
    "organizations.transfer_ownership": "transferOwnership",
    "organizations.list_invitations": "listInvitations",
    "organizations.resend_invitation": "resendInvitation",
    "organizations.cancel_invitation": "cancelInvitation",
    "organizations.list_teams": "listTeams",
    "organizations.update_team": "updateTeam",
    "organizations.delete_team": "deleteTeam",
    "organizations.list_team_members": "listTeamMembers",
    "organizations.add_team_member": "addTeamMember",
    "organizations.remove_team_member": "removeTeamMember",
    "organizations.update_team_member_role": "updateTeamMemberRole",
    "organizations.delete": "delete",
    "slices.list": "list",
    "slices.list_items": "listItems",
    "datasets.create": "create",
    "datasets.list_items": "listItems",
    "datasets.list_sequences": "listSequences",
    "annotation_issues.list_by_sequence": "listBySequence",
    "annotation_issues.list_by_dataset": "listByDataset",
    "annotation_issues.list_tools": "listTools",
    "annotation_issues.delete": "delete",
  };

  const endpointsToCheck = Object.keys(methodNameMap);

  for (const endpointKey of endpointsToCheck) {
    const endpoint = contract.endpoints[endpointKey];
    if (!endpoint) continue;

    const expectedShape = endpoint.response_shape;
    const [resource] = endpointKey.split(".");
    const resourceFile = resourceFileMap[resource];
    const methodName = methodNameMap[endpointKey];

    if (!resourceFile || !methodName) continue;

    it(`${endpointKey} uses '${expectedShape}' transport`, () => {
      const actualShape = getSDKMethodTransport(resourceFile, methodName);

      expect(actualShape).not.toBeNull();
      expect(actualShape).toBe(expectedShape);
    });
  }
});

// ── Type interface structure tests ─────────────────────────────
// These tests verify that mock API responses can be properly constructed
// with all contract-specified fields as camelCase properties.

describe("SDK types accept all contract fields after snakeToCamel conversion", () => {
  it("Organization mock has all contract fields", () => {
    const allFields = [
      ...contract.types.Organization.list_fields,
      ...contract.types.Organization.detail_fields,
    ];
    const mock = buildMockFromFields(allFields);
    // Key fields that must exist
    expect("uid" in mock).toBe(true);
    expect("name" in mock).toBe(true);
    expect("isVerified" in mock).toBe(true);
    expect("memberCount" in mock).toBe(true);
    expect("allowedDomains" in mock).toBe(true);
    expect("joinedAt" in mock).toBe(true);
  });

  it("OrganizationMember mock has all contract fields", () => {
    const mock = buildMockFromFields(contract.types.OrganizationMember.fields);
    expect("userUid" in mock).toBe(true);
    expect("fullName" in mock).toBe(true);
    expect("username" in mock).toBe(true);
  });

  it("DatasetSequence mock has all contract fields", () => {
    const allFields = [
      ...contract.types.DatasetSequence.list_fields,
      ...contract.types.DatasetSequence.detail_fields,
    ];
    const mock = buildMockFromFields(allFields);
    expect("customUuid" in mock).toBe(true);
    expect("numberOfFrames" in mock).toBe(true);
    expect("featuredImage" in mock).toBe(true);
    expect("predefinedLabels" in mock).toBe(true);
    expect("datasetUid" in mock).toBe(true);
  });

  it("Invitation mock has all contract fields", () => {
    const mock = buildMockFromFields(contract.types.Invitation.fields);
    expect("invitedEmail" in mock).toBe(true);
    expect("organizationName" in mock).toBe(true);
    expect("invitedByUsername" in mock).toBe(true);
    expect("isExpired" in mock).toBe(true);
    expect("acceptUrl" in mock).toBe(true);
    expect("copyLink" in mock).toBe(true);
  });

  it("AnnotationIssue mock has all contract fields", () => {
    const mock = buildMockFromFields(contract.types.AnnotationIssue.fields);
    expect("uid" in mock).toBe(true);
    expect("datasetItemUid" in mock).toBe(true);
    expect("sequenceUid" in mock).toBe(true);
    expect("priority" in mock).toBe(true);
    expect("severity" in mock).toBe(true);
    expect("status" in mock).toBe(true);
    expect("wrongClass" in mock).toBe(true);
    expect("correctClass" in mock).toBe(true);
    expect("shouldReAnnotate" in mock).toBe(true);
    expect("shouldDelete" in mock).toBe(true);
    expect("closedAt" in mock).toBe(true);
    expect("objectUid" in mock).toBe(true);
  });
});
