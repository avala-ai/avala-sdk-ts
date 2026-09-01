import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import toolsetScopes from "../toolset-scopes.json";
import { registerTools } from "../src/server.js";

const serverToolsetScopesPath = fileURLToPath(
  new URL(
    "../../../../../server/server/apps/account/mcp_toolset_scopes.json",
    import.meta.url,
  ),
);
const monorepoAvailable = existsSync(
  fileURLToPath(new URL("../../../../../DOCTRINE.md", import.meta.url)),
);
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
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    return null;
  return value;
}

/**
 * Toolsets granted by credential PRIVILEGE, not by scope intersection.
 *
 * `staff` must never enter toolset-scopes.json / mcp_toolset_scopes.json:
 * Django's `toolsets_for_permissions` hands a customer every manifest toolset
 * whose scope set intersects the credential's, and then adds `staff` only for
 * `is_staff_privileged` credentials — putting it in the manifest would list
 * the staff sandbox for any customer credential carrying `mcp.query`. The
 * scopes here mirror the exact `HasScope` gates on the Django endpoints in
 * the privileged toolset: the SQL sandbox, workforce operations overview,
 * and reviewed workforce mutations.
 */
const PRIVILEGED_TOOLSET_SCOPES: Record<string, readonly string[]> = {
  staff: ["mcp.query", "workforce.read", "workforce.write"],
};

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
      const anyScopes =
        stringArray(meta?.["avala.ai/required-any-scopes"]) ??
        (typeof meta?.["avala.ai/required-any-scope"] === "string"
          ? [meta["avala.ai/required-any-scope"] as string]
          : null);
      const toolsets =
        stringArray(meta?.["avala.ai/toolsets"]) ??
        (typeof singleToolset === "string" ? [singleToolset] : null);

      expect(
        scopes !== null || anyScopes !== null,
        `${name} must declare required scope metadata`,
      ).toBe(true);
      expect(toolsets, `${name} must declare toolset metadata`).not.toBeNull();
      expect([...(scopes ?? []), ...(anyScopes ?? [])]).not.toHaveLength(0);
      expect(toolsets).not.toHaveLength(0);

      for (const toolset of toolsets!) {
        const privilegedScopes = PRIVILEGED_TOOLSET_SCOPES[toolset];
        if (privilegedScopes !== undefined) {
          expect(
            (toolsetScopes as Record<string, string[]>)[toolset],
            `privileged toolset '${toolset}' must stay out of the scope-discovery manifest`,
          ).toBeUndefined();
          for (const scope of scopes ?? []) {
            expect(
              privilegedScopes,
              `${name} requires '${scope}' but the privileged toolset '${toolset}' does not carry it`,
            ).toContain(scope);
          }
          if ((anyScopes ?? []).length > 0) {
            expect(
              (anyScopes ?? []).some((scope) =>
                privilegedScopes.includes(scope),
              ),
              `${name} has no alternative scope carried by privileged toolset '${toolset}'`,
            ).toBe(true);
          }
          continue;
        }
        const discoverableScopes = (toolsetScopes as Record<string, string[]>)[
          toolset
        ];
        expect(
          discoverableScopes,
          `${name} uses unknown toolset '${toolset}'`,
        ).toBeDefined();
        for (const scope of scopes ?? []) {
          expect(
            discoverableScopes,
            `${name} requires '${scope}' but discovery omits it from '${toolset}'`,
          ).toContain(scope);
        }
        if ((anyScopes ?? []).length > 0) {
          expect(
            (anyScopes ?? []).some((scope) =>
              discoverableScopes.includes(scope),
            ),
            `${name} has no alternative scope carried by '${toolset}'`,
          ).toBe(true);
        }
      }

      for (const scope of anyScopes ?? []) {
        expect(
          toolsets!.some((toolset) =>
            (
              PRIVILEGED_TOOLSET_SCOPES[toolset] ??
              (toolsetScopes as Record<string, string[]>)[toolset] ??
              []
            ).includes(scope),
          ),
          `${name} alternative scope '${scope}' is not carried by any declared toolset`,
        ).toBe(true);
      }
    }
  });
});
