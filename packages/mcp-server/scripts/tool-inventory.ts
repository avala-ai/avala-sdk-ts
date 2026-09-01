/**
 * Phase 0 tool-surface inventory (standing brief §4.1).
 *
 * Registers the live catalog against a capture harness and emits every tool's
 * description, input schema, annotations, declared scope, upstream REST route,
 * and — the part no other introspection here captures — whether the handler
 * routes through the sanitizing catalog wrapper or stringifies raw upstream
 * JSON. That last column is what tells you which tools can leak a presigned
 * URL or an annotator's name into a transcript.
 *
 *   bun scripts/tool-inventory.ts            # markdown to stdout
 *   bun scripts/tool-inventory.ts --json     # machine-readable
 */
import { TOOL_REGISTRARS } from "../src/server.js";
import { collectRestMetadata } from "./tool-inventory-metadata.js";

interface Captured {
  name: string;
  category: string;
  description: string;
  inputKeys: string[];
  hasOutputSchema: boolean;
  annotations: Record<string, unknown> | null;
  scope: string | null;
  toolset: string | null;
  restRoute: string | null;
  restMethod: string | null;
  restUpstream: string | null;
  viaCatalog: boolean;
  handlerStringify: "safeStringify" | "raw JSON.stringify" | "catalog" | "other";
}

function metadataRequirement(
  meta: Record<string, unknown>,
  singular: string,
  plural: string,
): string[] {
  const many = meta[plural];
  if (Array.isArray(many)) {
    return many.filter((value): value is string => typeof value === "string");
  }
  const one = meta[singular];
  return typeof one === "string" ? [one] : [];
}

function shapeKeys(inputSchema: unknown): string[] {
  if (typeof inputSchema !== "object" || inputSchema === null) return [];
  const s = inputSchema as { shape?: Record<string, unknown>; _def?: { shape?: unknown } };
  const shape =
    s.shape ??
    (typeof s._def?.shape === "function" ? (s._def.shape as () => Record<string, unknown>)() : s._def?.shape);
  return shape ? Object.keys(shape as Record<string, unknown>) : Object.keys(s as Record<string, unknown>);
}

function collect(allowMutations: boolean): Map<string, Captured> {
  const out = new Map<string, Captured>();
  for (const registrar of TOOL_REGISTRARS) {
    const capture = (name: string, config: any, handler?: unknown): void => {
      const meta = (config?._meta ?? {}) as Record<string, unknown>;
      const body = typeof handler === "function" ? handler.toString() : "";
      const restRoutes = meta["avala.ai/rest-routes"];
      const viaCatalog = Boolean(
        meta["avala.ai/rest-route"] ||
          (Array.isArray(restRoutes) && restRoutes.length > 0),
      );
      const { restRoute, restMethod, restUpstream } =
        collectRestMetadata(meta);
      const requiredScopes = metadataRequirement(
        meta,
        "avala.ai/required-scope",
        "avala.ai/required-scopes",
      );
      const requiredAnyScopes = metadataRequirement(
        meta,
        "avala.ai/required-any-scope",
        "avala.ai/required-any-scopes",
      );
      const toolsets = metadataRequirement(
        meta,
        "avala.ai/toolset",
        "avala.ai/toolsets",
      );
      out.set(name, {
        name,
        category: registrar.category,
        description: config?.description ?? "",
        inputKeys: shapeKeys(config?.inputSchema),
        hasOutputSchema: Boolean(config?.outputSchema),
        annotations: config?.annotations ?? null,
        scope:
          [
            ...requiredScopes,
            ...(requiredAnyScopes.length > 0
              ? [`any(${requiredAnyScopes.join(", ")})`]
              : []),
          ].join(" & ") || null,
        toolset: toolsets.join(" / ") || null,
        restRoute,
        restMethod,
        restUpstream,
        viaCatalog,
        handlerStringify: viaCatalog
          ? "catalog"
          : body.includes("safeStringify")
            ? "safeStringify"
            : body.includes("JSON.stringify")
              ? "raw JSON.stringify"
              : "other",
      });
    };
    const server = {
      tool: (n: string, d: string, i: unknown, h?: unknown) => capture(n, { description: d, inputSchema: i }, h),
      registerTool: (n: string, c: unknown, h?: unknown) => capture(n, c, h),
    };
    const getClient = () => {
      throw new Error("no client during registration");
    };
    registrar.register(server as never, getClient as never, { allowMutations });
  }
  return out;
}

const readOnly = new Set(collect(false).keys());
const all = [...collect(true).values()].map((t) => ({ ...t, isMutation: !readOnly.has(t.name) }));

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(all, null, 2));
} else {
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  console.log(`# MCP tool inventory\n`);
  console.log(`> The **Serialization** column describes each tool's OWN handling only.\n` +
    `> Since \`src/egress.ts\`, every ordinary tool result is scrubbed at a single\n` +
    `> server-level boundary regardless of this column — a tool marked **raw** is no\n` +
    `> longer unprotected, it simply does no redaction of its own. The resolver's\n` +
    `> exact two-field result is the sole deliberate capability release.\n`);
  console.log(`Generated by \`bun scripts/tool-inventory.ts\`. ${all.length} tools ` +
    `(${all.filter((t) => !t.isMutation).length} read, ${all.filter((t) => t.isMutation).length} mutation).\n`);
  console.log(`| Tool | Kind | Upstream route | Scope | Annotated | outputSchema | Serialization | Inputs |`);
  console.log(`|---|---|---|---|---|---|---|---|`);
  for (const t of all) {
    console.log(
      `| \`${t.name}\` | ${t.isMutation ? "mutation" : "read"} | ${t.restUpstream ? `\`${t.restUpstream}\`` : "_hand-written_"} ` +
        `| ${t.scope ?? "—"} | ${t.annotations ? "yes" : "**no**"} | ${t.hasOutputSchema ? "yes" : "**no**"} ` +
        `| ${t.handlerStringify === "raw JSON.stringify" ? "**raw**" : t.handlerStringify} | ${t.inputKeys.join(", ") || "—"} |`,
    );
  }
  console.log(`\n## Descriptions\n`);
  for (const t of all) console.log(`- \`${t.name}\` — ${esc(t.description)}`);
}
