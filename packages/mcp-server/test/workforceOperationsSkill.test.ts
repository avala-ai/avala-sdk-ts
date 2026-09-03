import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  WORKFORCE_MUTATION_CATALOG_TOOLS,
  WORKFORCE_READ_CATALOG_TOOLS,
} from "../src/tools/workforce.js";

const skillPath = fileURLToPath(
  new URL(
    "../../../../../.claude/skills/avala-physical-ai-operations/SKILL.md",
    import.meta.url,
  ),
);
const toolMapPath = fileURLToPath(
  new URL(
    "../../../../../.claude/skills/avala-physical-ai-operations/references/tool-map.md",
    import.meta.url,
  ),
);
const monorepoAvailable = existsSync(
  fileURLToPath(new URL("../../../../../DOCTRINE.md", import.meta.url)),
);
if (monorepoAvailable && (!existsSync(skillPath) || !existsSync(toolMapPath))) {
  throw new Error("The monorepo workforce operations skill is missing.");
}

describe.skipIf(!monorepoAvailable)("Avala Physical AI operations skill", () => {
  it("keeps its workforce tool map synchronized with the registered catalog", () => {
    const toolMap = readFileSync(toolMapPath, "utf8");
    const documentedRows = [...toolMap.matchAll(
      /^\| `([^`]+)` \|.*\| `([^`]+)` \|$/gm,
    )].map((match) => ({ name: match[1]!, scope: match[2]! }));
    const expectedRows = [
      ...WORKFORCE_READ_CATALOG_TOOLS,
      ...WORKFORCE_MUTATION_CATALOG_TOOLS,
    ].map((tool) => ({ name: tool.name, scope: tool.route.scope }));

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
});
