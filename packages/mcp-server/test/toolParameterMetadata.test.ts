import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parameterType } from "../scripts/generate-mcp-docs.js";

describe("generated MCP parameter types", () => {
  it.each([
    [z.number().int().min(1).max(50).default(25), "number"],
    [z.number().nullable().optional(), "number"],
    [z.boolean().optional(), "boolean"],
    [z.array(z.string()).optional(), "array"],
    [z.object({ uid: z.string() }), "object"],
    [z.record(z.string(), z.string()), "object"],
    [
      z.enum(["finished", "abandoned"]).optional(),
      "string (`finished`, `abandoned`)",
    ],
  ])(
    "preserves current Zod types through optional/default wrappers",
    (schema, expected) => {
      expect(parameterType(schema)).toBe(expected);
    },
  );

  it("retains the legacy Zod type metadata format", () => {
    expect(
      parameterType({
        _def: {
          typeName: "ZodOptional",
          innerType: { _def: { typeName: "ZodNumber" } },
        },
      }),
    ).toBe("number");
  });
});
