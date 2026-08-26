import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");

describe("hosted MCP Docker runtime", () => {
  it("materializes Node-resolvable production dependencies", () => {
    expect(dockerfile).toContain("bun install --frozen-lockfile --production --linker hoisted");
    expect(dockerfile).toContain('CMD ["node", "dist/http.js"]');
  });
});
