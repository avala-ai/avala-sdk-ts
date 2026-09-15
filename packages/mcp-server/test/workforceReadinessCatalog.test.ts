import { z } from "zod";
import { OPERATION_PROPOSAL_TOOLS } from "../src/tools/operationProposals.js";
import { WORKFORCE_SESSION_MONITORING_TOOLS } from "../src/tools/workforceSessionMonitoring.js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  WORKFORCE_MUTATION_CATALOG_TOOLS,
  WORKFORCE_READ_CATALOG_TOOLS,
} from "../src/tools/workforce.js";

const scriptsPath = fileURLToPath(
  new URL("../../../../../scripts/", import.meta.url),
);
const inMonorepo = existsSync(
  new URL("../../../../../DOCTRINE.md", import.meta.url),
);

// Run only in the monorepo; the published standalone SDK has no ops scripts.
// Importing this dependency-free module never contacts a service or reads secrets.
describe.skipIf(!inMonorepo)("reviewed production workforce catalog", () => {
  it("validates the actual runtime command JSON schemas with the Python readiness gate", () => {
    const schemas = Object.fromEntries(
      OPERATION_PROPOSAL_TOOLS.filter((tool) => tool.method === "POST").map(
        (tool) => [tool.name, z.toJSONSchema(tool.inputSchema)],
      ),
    );
    const errors = JSON.parse(
      execFileSync(
        "python3",
        [
          "-c",
          [
            "import json, sys",
            "sys.path.insert(0, sys.argv[1])",
            "import mcp_production_readiness as r",
            "schemas = json.load(sys.stdin)",
            "assert set(schemas) == set(r.PROPOSAL_COMMAND_REQUIRED_INPUTS)",
            "print(json.dumps({name: r._proposal_command_schema_error(name, schema) for name, schema in schemas.items()}))",
          ].join("\n"),
          scriptsPath,
        ],
        { input: JSON.stringify(schemas), encoding: "utf8" },
      ),
    );
    expect(Object.values(errors)).toEqual(Array(5).fill(null));
  });

  it("documents every proposal deployment scope and both candidate alternatives", () => {
    const readme = readFileSync(
      new URL("../README.md", import.meta.url),
      "utf8",
    );
    const deployment =
      readme.split("Hosted operators must configure")[1]?.split("\n\n")[0] ??
      "";
    for (const scope of new Set([
      "mcp.staff_access",
      "workforce.read",
      ...OPERATION_PROPOSAL_TOOLS.map((tool) => tool.scope),
    ]))
      expect(deployment).toContain(`\`${scope}\``);
    const docs = readFileSync(
      new URL(
        "../skills/avala-physical-ai-operations/references/tool-map.md",
        import.meta.url,
      ),
      "utf8",
    );
    const candidate = WORKFORCE_READ_CATALOG_TOOLS.find(
      (tool) => tool.name === "list_workforce_assignment_candidates",
    )!;
    const row = docs
      .split("\n")
      .find((line) =>
        line.startsWith("| `list_workforce_assignment_candidates` |"),
      )!;
    const documentedScopes = row
      .split("|")
      .at(-2)!
      .trim()
      .replaceAll("`", "")
      .split(" OR ");
    expect(documentedScopes.sort()).toEqual(
      [
        candidate.route.scope,
        ...(candidate.route.alternativeScopes ?? []),
      ].sort(),
    );
  });

  it("binds explicit Python allowlists directly to runtime scope and mutation kind", () => {
    const reviewed = JSON.parse(
      execFileSync(
        "python3",
        [
          "-c",
          [
            "import json, sys",
            "sys.path.insert(0, sys.argv[1])",
            "import mcp_production_readiness as r",
            "print(json.dumps({'proposals': r.OPERATION_PROPOSAL_TOOL_SCOPES, 'proposalReads': sorted(r.OPERATION_PROPOSAL_READ_TOOLS), 'monitoring': sorted(r.HOSTED_STAFF_MONITORING_TOOLS), 'planning': sorted(r.HOSTED_STAFF_PLANNING_TOOLS), 'mutations': sorted(r.HOSTED_STAFF_MUTATION_TOOLS)}))",
          ].join("\n"),
          scriptsPath,
        ],
        { encoding: "utf8" },
      ),
    );
    expect(reviewed).toEqual({
      proposals: Object.fromEntries(
        OPERATION_PROPOSAL_TOOLS.map((tool) => [tool.name, tool.scope]),
      ),
      proposalReads: OPERATION_PROPOSAL_TOOLS.filter(
        (tool) => tool.method === "GET",
      )
        .map((tool) => tool.name)
        .sort(),
      monitoring: [
        ...WORKFORCE_READ_CATALOG_TOOLS,
        ...WORKFORCE_SESSION_MONITORING_TOOLS,
      ]
        .filter((tool) => tool.route.scope === "workforce.read")
        .map((tool) => tool.name)
        .sort(),
      planning: WORKFORCE_READ_CATALOG_TOOLS.filter(
        (tool) => tool.route.scope === "workforce.write",
      )
        .map((tool) => tool.name)
        .sort(),
      mutations: WORKFORCE_MUTATION_CATALOG_TOOLS.map(
        (tool) => tool.name,
      ).sort(),
    });
  });
});
