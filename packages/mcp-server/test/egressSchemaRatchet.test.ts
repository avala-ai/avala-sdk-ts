/**
 * Two ratchets from the adversarial review of the one-time-secret redaction
 * (AVALA-SEC-2026-0119 follow-up).
 *
 * 1. Redaction runs BEFORE the MCP SDK validates `structuredContent` against
 *    the tool's `outputSchema` (confirmed in @modelcontextprotocol/server:
 *    `executeToolHandler` runs the wrapped executor, then `validateToolOutput`).
 *    A sensitive-named field typed as anything but a string is therefore a
 *    landmine: redaction writes "[redacted]" into it and the SDK turns a
 *    successful call into a ProtocolError. No shipped schema does this today;
 *    this test keeps it that way.
 * 2. Content shapes the boundary was once blind to — an EmbeddedResource
 *    block, a BOM-prefixed text block, JSON nested inside a JSON string —
 *    must stay redacted. Each was a reproduced leak against an earlier
 *    revision that re-parsed only `content[].text`.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { registerTools } from "../src/server.js";
import { isSensitiveOutputKey, REDACTED_OUTPUT_VALUE } from "../src/redact.js";
import { scrubToolResult } from "../src/egress.js";

type ToolConfig = { outputSchema?: z.ZodTypeAny };

/** zod 4 keeps its definition on `_zod.def`; `type` is the node kind. */
interface ZodDef {
  type: string;
  innerType?: z.ZodTypeAny;
  in?: z.ZodTypeAny;
  shape?: Record<string, z.ZodTypeAny>;
  element?: z.ZodTypeAny;
  options?: z.ZodTypeAny[];
  valueType?: z.ZodTypeAny;
}

function def(schema: z.ZodTypeAny): ZodDef {
  return (schema as unknown as { _zod: { def: ZodDef } })._zod.def;
}

/** Strip optional/nullable/default/pipe wrappers down to the carrier node. */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  for (;;) {
    const d = def(current);
    if (d.innerType) current = d.innerType;
    else if (d.in) current = d.in;
    else return current;
  }
}

/** Every (path, leaf node kind) pair reachable through objects, arrays, records, unions. */
function leaves(schema: z.ZodTypeAny, path: string[] = []): [string[], string][] {
  const inner = unwrap(schema);
  const d = def(inner);
  if (d.type === "object" && d.shape) {
    return Object.entries(d.shape).flatMap(([key, child]) => leaves(child, [...path, key]));
  }
  if (d.type === "array" && d.element) return leaves(d.element, [...path, "[]"]);
  if (d.type === "record" && d.valueType) return leaves(d.valueType, [...path, "{}"]);
  if (d.type === "union" && d.options) return d.options.flatMap((o) => leaves(o, path));
  return [[path, d.type]];
}

describe("outputSchema ratchet: sensitive-named fields must be strings", () => {
  it("no registered tool declares a sensitive-named field with a non-string type", () => {
    const registrations = new Map<string, ToolConfig>();
    const server = {
      tool: vi.fn(),
      registerTool: vi.fn((name: string, config: ToolConfig) => {
        registrations.set(name, config);
      }),
    };
    registerTools(
      server as never,
      (() => {
        throw new Error("Registration must not resolve a credential");
      }) as never,
      { allowMutations: true },
    );
    expect(registrations.size).toBeGreaterThan(0);

    const offenders: string[] = [];
    let sensitiveLeaves = 0;
    let schemas = 0;
    for (const [name, config] of registrations) {
      if (!config.outputSchema) continue;
      schemas += 1;
      for (const [path, kind] of leaves(config.outputSchema)) {
        const key = path[path.length - 1];
        if (!key || key === "[]" || key === "{}" || !isSensitiveOutputKey(key)) continue;
        sensitiveLeaves += 1;
        if (kind !== "string" && kind !== "any" && kind !== "unknown") {
          offenders.push(`${name}: ${path.join(".")} is ${kind}`);
        }
      }
    }
    // Measured 2026-09-15: the catalog projects credentials away, so NO output
    // schema names a sensitive field today (sensitiveLeaves === 0). The ratchet
    // is therefore about the future; what it must not be is blind, which the
    // walker test below and the schema count here guard against.
    expect(schemas).toBeGreaterThan(20);
    expect(sensitiveLeaves).toBe(0);
    expect(offenders, "redaction would write \"[redacted]\" into a non-string field and fail SDK output validation").toEqual([]);
  });
});

describe("the schema walker itself", () => {
  it("finds a sensitive non-string leaf behind optional/array/union/record wrappers", () => {
    const schema = z.object({
      ok: z.string(),
      nested: z.array(z.object({ deviceToken: z.number().optional() })),
      either: z.union([z.string(), z.object({ clientSecret: z.boolean() })]),
      map: z.record(z.string(), z.object({ apiKey: z.string().nullable() })),
    });
    const found = leaves(schema)
      .filter(([path]) => isSensitiveOutputKey(path[path.length - 1] ?? ""))
      .map(([path, kind]) => `${path.join(".")}:${kind}`);
    expect(found).toEqual(["nested.[].deviceToken:number", "either.clientSecret:boolean", "map.{}.apiKey:string"]);
  });
});

describe("content shapes the boundary must keep covering", () => {
  const SECRET = "3f9c1b2a8d7e6f5049e8b7a6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6";

  it("an EmbeddedResource block carrying JSON text", () => {
    const out = scrubToolResult("x", {
      content: [{ type: "resource" as const, resource: { uri: "avala://webhook/wh_1", mimeType: "application/json", text: JSON.stringify({ uid: "wh_1", secret: SECRET }, null, 2) } }],
    });
    const text = (out.content[0] as { resource: { text: string } }).resource.text;
    expect(text).not.toContain(SECRET);
    expect(JSON.parse(text).secret).toBe(REDACTED_OUTPUT_VALUE);
  });

  it("a BOM-prefixed JSON text block", () => {
    const out = scrubToolResult("x", { content: [{ type: "text" as const, text: "﻿" + JSON.stringify({ secret: SECRET }) }] });
    expect(out.content[0]!.text).not.toContain(SECRET);
  });

  it("JSON nested inside a JSON string value", () => {
    const inner = JSON.stringify({ secret: SECRET });
    const out = scrubToolResult("x", { content: [{ type: "text" as const, text: JSON.stringify({ uid: "wh_1", body: inner }) }] });
    expect(out.content[0]!.text).not.toContain(SECRET);
  });

  it("JSON embedded in prose", () => {
    const out = scrubToolResult("x", { content: [{ type: "text" as const, text: `Created: {"uid":"wh_1","secret":"${SECRET}"} — store it.` }] });
    expect(out.content[0]!.text).not.toContain(SECRET);
    expect(out.content[0]!.text).toContain("Created:");
  });
});
