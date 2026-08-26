import { afterEach, describe, expect, it, vi } from "vitest";
import { Avala } from "../../src/client.js";
import type {
  CredentialPermissions,
  CredentialPersona,
  UserPermissions,
  UserType,
} from "../../src/index.js";

describe("permissions resource", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps future server-defined personas type-safe", () => {
    const persona: CredentialPersona = "service_agent";

    expect(persona).toBe("service_agent");
  });

  it("keeps credential permission types available from the public barrel", () => {
    const persona: CredentialPersona = "customer";
    const deprecatedPersona: UserType = persona;
    const permissions: CredentialPermissions = {
      type: persona,
      isStaffPrivileged: false,
      scopes: [],
      capabilities: [],
      toolsets: ["docs", "public"],
    };
    const deprecatedPermissions: UserPermissions = permissions;

    expect(deprecatedPersona).toBe("customer");
    expect(deprecatedPermissions).toBe(permissions);
  });

  it("discovers capabilities for the current credential", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () =>
          Promise.resolve({
            type: "customer",
            is_staff_privileged: false,
            scopes: ["datasets.read", "projects.read"],
            capabilities: ["polyline_crop_editor", "qc_review"],
            toolsets: ["datasets", "docs", "episodes", "items", "projects", "public", "quality", "sequences"],
          }),
      }),
    );

    const avala = new Avala({ apiKey: "test-key" });
    const permissions = await avala.permissions.get();

    expect(permissions).toEqual({
      type: "customer",
      isStaffPrivileged: false,
      scopes: ["datasets.read", "projects.read"],
      capabilities: ["polyline_crop_editor", "qc_review"],
      toolsets: ["datasets", "docs", "episodes", "items", "projects", "public", "quality", "sequences"],
    });

    const [url, request] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.avala.ai/api/v1/users/me/permissions/");
    expect(request?.method).toBe("GET");
  });

  it("preserves an empty grant for a valid restricted credential", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () =>
          Promise.resolve({
            type: "customer",
            is_staff_privileged: false,
            scopes: [],
            capabilities: [],
            toolsets: ["docs", "public"],
          }),
      }),
    );

    const avala = new Avala({ apiKey: "restricted-key" });
    const permissions = await avala.permissions.get();

    expect(permissions.scopes).toEqual([]);
    expect(permissions.capabilities).toEqual([]);
    expect(permissions.toolsets).toEqual(["docs", "public"]);
    expect(permissions.isStaffPrivileged).toBe(false);
  });

  it("preserves coworker persona discovery", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () =>
          Promise.resolve({
            type: "coworker",
            is_staff_privileged: false,
            scopes: [],
            capabilities: [],
            toolsets: ["coworker", "docs", "public"],
          }),
      }),
    );

    const avala = new Avala({ apiKey: "coworker-key" });
    const permissions = await avala.permissions.get();

    expect(permissions.type).toBe("coworker");
    expect(permissions.toolsets).toEqual(["coworker", "docs", "public"]);
  });

  it("preserves credential-scoped staff privilege", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () =>
          Promise.resolve({
            type: "customer",
            is_staff_privileged: true,
            scopes: ["mcp.query"],
            capabilities: [
              "camera_calibration_editor",
              "cuboid_generate_2d",
              "lidar_calibration_editor",
              "polyline_crop_editor",
              "qc_review",
            ],
            toolsets: ["docs", "public", "staff"],
          }),
      }),
    );

    const avala = new Avala({ apiKey: "staff-access-key" });
    const permissions = await avala.permissions.get();

    expect(permissions.isStaffPrivileged).toBe(true);
    expect(permissions.scopes).toEqual(["mcp.query"]);
    expect(permissions.capabilities).toEqual([
      "camera_calibration_editor",
      "cuboid_generate_2d",
      "lidar_calibration_editor",
      "polyline_crop_editor",
      "qc_review",
    ]);
    expect(permissions.toolsets).toContain("staff");
  });
});
