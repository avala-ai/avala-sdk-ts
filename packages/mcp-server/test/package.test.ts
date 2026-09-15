import { describe, expect, it } from "vitest";
import mcp from "../package.json";
import sdk from "../../sdk/package.json";

describe("published package contract", () => {
  it("includes the first-party skills in the npm artifact", () => {
    expect(mcp.files).toContain("skills");
  });

  it("does not install agent configuration through npm lifecycle hooks", () => {
    expect(Object.keys(mcp.scripts).filter((name) =>
      ["preinstall", "install", "postinstall"].includes(name),
    )).toEqual([]);
  });

  it("ships the SDK and MCP server at the same version", () => {
    expect(mcp.version).toBe(sdk.version);
  });

  it("pins the SDK using the exact release version npm can install", () => {
    // npm pack does not rewrite workspace:* (unlike bun pm pack).
    // Exact equality also makes every paired version bump update this edge.
    expect(mcp.dependencies["@avala-ai/sdk"]).toBe(sdk.version);
  });
});
