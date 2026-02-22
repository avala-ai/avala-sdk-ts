import { describe, it, expect } from "vitest";
import { registerTools } from "../src/server.js";

describe("MCP server", () => {
  it("registerTools is a function", () => {
    expect(typeof registerTools).toBe("function");
  });
});
