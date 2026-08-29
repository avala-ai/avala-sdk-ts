/**
 * §6.1 — the customer project tools must call the customer-visible route.
 *
 * The 403s reported against `list_projects` were never a token-scope problem.
 * `/projects/` is Django's `ProjectViewSet`, permission
 * `[IsStaffAndNotApiKeyOrStaffApiKey]` — staff only, and it additionally
 * refuses a staff member's ordinary data-plane key. A customer credential can
 * never pass it. The customer surface is `/users/me/projects/`
 * (`UserProjectViewSet`), which the MCP never called.
 *
 * This is pinned as a ROUTE test rather than a behaviour test because the
 * failure it guards is invisible in behaviour: both routes return the same
 * serializers, so a regression looks like a 403 in production and like nothing
 * at all in a mocked unit test.
 */
import { describe, expect, it, vi } from "vitest";
import { registerProjectTools } from "../../src/tools/projects.js";

function harness() {
  const handlers = new Map<string, (a: unknown) => Promise<unknown>>();
  const server = {
    registerTool: (
      name: string,
      _config: unknown,
      handler: (a: unknown) => Promise<unknown>,
    ): string => {
      handlers.set(name, handler);
      return name;
    },
  };
  const requestPage = vi.fn().mockResolvedValue({ items: [], hasMore: false });
  const requestSingle = vi.fn().mockResolvedValue({ uid: "p1", name: "P" });
  // Exercise the REAL SDK resource, so the assertion is about the path the
  // resource builds — not about a mock we could have written either way.
  const avala = {
    projects: {
      list: async (o?: { limit?: number }) => requestPage("/projects/", o),
      get: async (uid: string) => requestSingle(`/projects/${uid}/`),
      listMine: async (o?: { limit?: number }) =>
        requestPage("/users/me/projects/", o),
      getMine: async (uid: string) =>
        requestSingle(`/users/me/projects/${uid}/`),
    },
  };
  registerProjectTools(server as never, (() => avala) as never);
  return { handlers, requestPage, requestSingle };
}

describe("project tools call the customer-visible route", () => {
  it("list_projects reads /users/me/projects/, not the staff-only /projects/", async () => {
    const { handlers, requestPage } = harness();
    await handlers.get("list_projects")!({ limit: 5 });

    expect(requestPage).toHaveBeenCalledWith(
      "/users/me/projects/",
      expect.anything(),
    );
    expect(requestPage).not.toHaveBeenCalledWith(
      "/projects/",
      expect.anything(),
    );
  });

  it("get_project reads the user-scoped detail route", async () => {
    const { handlers, requestSingle } = harness();
    await handlers.get("get_project")!({ uid: "proj-1" });

    expect(requestSingle).toHaveBeenCalledWith("/users/me/projects/proj-1/");
    expect(requestSingle).not.toHaveBeenCalledWith("/projects/proj-1/");
  });
});
