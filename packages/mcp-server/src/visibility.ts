import type { McpServer } from "@modelcontextprotocol/server";

export interface CredentialToolGrant {
  readonly scopes: ReadonlySet<string>;
  readonly toolsets: ReadonlySet<string>;
  /**
   * Whether permission discovery reported this credential as staff-privileged
   * (`request_has_staff_privilege` on the server — a session, or an API key
   * with `is_staff_access`). Listing of the `staff` toolset already keys on
   * the discovered toolset set; this flag exists so the `staff_*` sandbox
   * proxies can additionally refuse to FORWARD a call for a non-staff
   * credential (defence in depth, mcp-platform-auth-model.md §5.4).
   */
  readonly isStaffPrivileged: boolean;
}

interface ToolRequirement {
  readonly scopes: readonly string[];
  readonly toolsets: readonly string[];
}

function stringRequirements(
  toolName: string,
  meta: Record<string, unknown>,
  singularKey: string,
  pluralKey: string,
  options: { allowEmpty: boolean },
): readonly string[] {
  const singular = meta[singularKey];
  const plural = meta[pluralKey];
  if (
    singular !== undefined &&
    (typeof singular !== "string" || singular.trim() === "")
  ) {
    throw new Error(
      `Hosted MCP tool '${toolName}' has invalid '${singularKey}' metadata.`,
    );
  }
  if (
    plural !== undefined &&
    (!Array.isArray(plural) ||
      (!options.allowEmpty && plural.length === 0) ||
      !plural.every(
        (value) => typeof value === "string" && value.trim() !== "",
      ))
  ) {
    throw new Error(
      `Hosted MCP tool '${toolName}' has invalid '${pluralKey}' metadata.`,
    );
  }
  if (singular === undefined && plural === undefined) {
    throw new Error(
      `Hosted MCP tool '${toolName}' is missing authorization metadata.`,
    );
  }

  const values =
    plural === undefined ? [singular as string] : (plural as string[]);
  if (new Set(values).size !== values.length) {
    throw new Error(
      `Hosted MCP tool '${toolName}' has duplicate '${pluralKey}' metadata.`,
    );
  }
  if (
    singular !== undefined &&
    plural !== undefined &&
    (values.length !== 1 || values[0] !== singular)
  ) {
    throw new Error(
      `Hosted MCP tool '${toolName}' has contradictory authorization metadata.`,
    );
  }
  return values;
}

function declarativeRequirement(
  toolName: string,
  config: unknown,
): ToolRequirement {
  if (typeof config !== "object" || config === null || !("_meta" in config)) {
    throw new Error(
      `Hosted MCP tool '${toolName}' is missing authorization metadata.`,
    );
  }
  const meta = (config as { _meta?: unknown })._meta;
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    throw new Error(
      `Hosted MCP tool '${toolName}' is missing authorization metadata.`,
    );
  }
  const record = meta as Record<string, unknown>;
  return {
    scopes: stringRequirements(
      toolName,
      record,
      "avala.ai/required-scope",
      "avala.ai/required-scopes",
      { allowEmpty: true },
    ),
    toolsets: stringRequirements(
      toolName,
      record,
      "avala.ai/toolset",
      "avala.ai/toolsets",
      {
        allowEmpty: false,
      },
    ),
  };
}

/**
 * Toolsets that discovery grants by credential privilege rather than by
 * scope. Listing one of these keys on the privilege flag as well as the
 * toolset set, so a discovery drift that hands out the toolset name without
 * the privilege cannot list the tools (mirrors the forward-time refusal in
 * `tools/staff.ts`).
 */
const PRIVILEGED_TOOLSETS: ReadonlySet<string> = new Set(["staff"]);

function isVisible(
  requirement: ToolRequirement,
  grant: CredentialToolGrant,
): boolean {
  return (
    requirement.scopes.every((scope) => grant.scopes.has(scope)) &&
    requirement.toolsets.some(
      (toolset) =>
        grant.toolsets.has(toolset) &&
        (!PRIVILEGED_TOOLSETS.has(toolset) || grant.isStaffPrivileged),
    )
  );
}

function removeIfHidden(
  registered: unknown,
  visible: boolean,
  toolName: string,
): unknown {
  if (visible) return registered;
  if (
    typeof registered !== "object" ||
    registered === null ||
    !("remove" in registered) ||
    typeof (registered as { remove?: unknown }).remove !== "function"
  ) {
    throw new Error(
      `Hosted MCP tool '${toolName}' could not be removed safely.`,
    );
  }
  (registered as { remove: () => void }).remove();
  return registered;
}

/**
 * Return a registration facade that exposes only tools eligible for one
 * credential. This is discovery hardening and agent UX, not authorization:
 * every invocation still reaches the REST API with the caller's credential.
 *
 * Registration is fail-closed. A new declarative tool without scope/toolset
 * metadata aborts the request instead of leaking a broader catalog.
 */
export function scopeServerForCredential(
  server: McpServer,
  grant: CredentialToolGrant,
): McpServer {
  return new Proxy(server, {
    get(target, property) {
      if (property === "registerTool") {
        return (
          name: unknown,
          config: unknown,
          ...rest: unknown[]
        ): unknown => {
          if (typeof name !== "string")
            throw new Error("Hosted MCP tool name must be a string.");
          const visible = isVisible(
            declarativeRequirement(name, config),
            grant,
          );
          const registered = Reflect.apply(target.registerTool, target, [
            name,
            config,
            ...rest,
          ]);
          return removeIfHidden(registered, visible, name);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
