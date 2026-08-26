import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const referenceUrl = new URL("../../../../../docs/sdks/typescript-reference.mdx", import.meta.url);
const monorepoSentinelUrl = new URL("../../../../../DOCTRINE.md", import.meta.url);
const monorepoAvailable = existsSync(fileURLToPath(monorepoSentinelUrl));
const referenceAvailable = existsSync(fileURLToPath(referenceUrl));
if (monorepoAvailable && !referenceAvailable) {
  throw new Error("Monorepo TypeScript SDK reference is missing.");
}

function resourceEntries(source: string, pattern: RegExp): [string, string][] {
  return [...source.matchAll(pattern)].map((match) => [match[1], match[2]]);
}

describe.skipIf(!monorepoAvailable)("TypeScript SDK reference", () => {
  it("documents every public Avala resource with its source type", () => {
    const client = readFileSync(new URL("../src/client.ts", import.meta.url), "utf8");
    const reference = readFileSync(referenceUrl, "utf8");
    const sourceResources = resourceEntries(
      client,
      /^\s*public readonly (\w+): (\w+Resource);$/gm,
    );
    const documentedResources = resourceEntries(
      reference,
      /^\| `avala\.(\w+)` \| `(\w+Resource)` \|/gm,
    );

    expect(documentedResources).toHaveLength(new Set(documentedResources.map(([name]) => name)).size);
    expect(Object.fromEntries(documentedResources)).toEqual(Object.fromEntries(sourceResources));
  });
});
