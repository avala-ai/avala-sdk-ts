import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import toolsetScopes from "../toolset-scopes.json";
import { registerTools } from "../src/server.js";

const serverToolsetScopesPath = fileURLToPath(
  new URL("../../../../../server/server/apps/account/mcp_toolset_scopes.json", import.meta.url),
);
const monorepoAvailable = existsSync(fileURLToPath(new URL("../../../../../DOCTRINE.md", import.meta.url)));
const serverToolsetScopesAvailable = existsSync(serverToolsetScopesPath);
if (monorepoAvailable && !serverToolsetScopesAvailable) {
  throw new Error("Monorepo MCP toolset scope manifest is missing.");
}
const serverToolsetScopes = serverToolsetScopesAvailable
  ? (JSON.parse(readFileSync(serverToolsetScopesPath, "utf8")) as unknown)
  : null;

type ToolConfig = {
  _meta?: Record<string, unknown>;
};

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return null;
  return value;
}

describe("credential toolset scope contract", () => {
  it.skipIf(!monorepoAvailable)(
    "keeps the server discovery manifest synchronized in monorepo SDK CI",
    () => {
      expect(serverToolsetScopes).toEqual(toolsetScopes);
    },
  );

  it("covers every declarative tool registered by the production catalog", () => {
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
      { allowMutations: false },
    );

    expect(registrations.size).toBeGreaterThan(0);
    expect(registrations.size).toBe(server.registerTool.mock.calls.length);
    for (const [name, config] of registrations) {
      const meta = config._meta;
      expect(meta, `${name} must publish authorization metadata`).toBeDefined();

      const singleScope = meta?.["avala.ai/required-scope"];
      const singleToolset = meta?.["avala.ai/toolset"];
      const scopes =
        stringArray(meta?.["avala.ai/required-scopes"]) ??
        (typeof singleScope === "string" ? [singleScope] : null);
      const toolsets =
        stringArray(meta?.["avala.ai/toolsets"]) ??
        (typeof singleToolset === "string" ? [singleToolset] : null);

      expect(scopes, `${name} must declare required scope metadata`).not.toBeNull();
      expect(toolsets, `${name} must declare toolset metadata`).not.toBeNull();
      expect(scopes).not.toHaveLength(0);
      expect(toolsets).not.toHaveLength(0);

      for (const toolset of toolsets!) {
        const discoverableScopes = (toolsetScopes as Record<string, string[]>)[toolset];
        expect(discoverableScopes, `${name} uses unknown toolset '${toolset}'`).toBeDefined();
        for (const scope of scopes!) {
          expect(
            discoverableScopes,
            `${name} requires '${scope}' but discovery omits it from '${toolset}'`,
          ).toContain(scope);
        }
      }
    }
  });
});
