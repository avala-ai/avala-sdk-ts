import { OPERATION_PROPOSAL_TOOLS } from "../src/tools/operationProposals.js";
import { WORKFORCE_SESSION_MONITORING_TOOLS } from "../src/tools/workforceSessionMonitoring.js";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  WORKFORCE_MUTATION_CATALOG_TOOLS,
  WORKFORCE_READ_CATALOG_TOOLS,
} from "../src/tools/workforce.js";

const skillPath = fileURLToPath(
  new URL(
    "../skills/avala-physical-ai-operations/SKILL.md",
    import.meta.url,
  ),
);
const toolMapPath = fileURLToPath(
  new URL(
    "../skills/avala-physical-ai-operations/references/tool-map.md",
    import.meta.url,
  ),
);
const monorepoAvailable = existsSync(
  fileURLToPath(new URL("../../../../../DOCTRINE.md", import.meta.url)),
);
describe(
  "Avala Physical AI operations skill",
  () => {
    it.skipIf(!monorepoAvailable)(
      "keeps the local discovery copy identical to the packaged skill",
      () => {
        for (const path of ["SKILL.md", "references/tool-map.md", "agents/openai.yaml"]) {
          const packaged = new URL(
            `../skills/avala-physical-ai-operations/${path}`,
            import.meta.url,
          );
          const local = new URL(
            `../../../../../.claude/skills/avala-physical-ai-operations/${path}`,
            import.meta.url,
          );
          expect(readFileSync(local, "utf8"), `Skill copy drift: ${path}`).toBe(
            readFileSync(packaged, "utf8"),
          );
        }
      },
    );

    it("keeps its workforce tool map synchronized with the registered catalog", () => {
      const toolMap = readFileSync(toolMapPath, "utf8");
      const documentedRows = [
        ...toolMap.matchAll(/^\| `([^`]+)` \|.*\| `([^`]+)` \|$/gm),
      ].map((match) => ({ name: match[1]!, scope: match[2]! }));
      const expectedRows = [
        ...WORKFORCE_READ_CATALOG_TOOLS,
        ...WORKFORCE_MUTATION_CATALOG_TOOLS,
        ...WORKFORCE_SESSION_MONITORING_TOOLS,
      ]
        .map((tool) => ({
          name: tool.name,
          scope:
            "alternativeScopes" in tool.route
              ? [tool.route.scope, ...tool.route.alternativeScopes!].join(
                  " OR ",
                )
              : tool.route.scope,
        }))
        .concat(
          OPERATION_PROPOSAL_TOOLS.map((tool) => ({
            name: tool.name,
            scope: tool.scope,
          })),
        );

      expect(new Set(documentedRows.map(({ name }) => name)).size).toBe(
        documentedRows.length,
      );
      expect(
        documentedRows
          .slice()
          .sort((left, right) => left.name.localeCompare(right.name)),
      ).toEqual(
        expectedRows
          .slice()
          .sort((left, right) => left.name.localeCompare(right.name)),
      );
    });

    it("routes detailed tool selection through the maintained reference", () => {
      const skill = readFileSync(skillPath, "utf8");

      expect(skill).toContain(
        "[references/tool-map.md](references/tool-map.md)",
      );
      expect(skill).not.toContain("[TODO:");
    });
  },
);
