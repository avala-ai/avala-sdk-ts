/**
 * §6.1 leftover — `get_workspace_stats` must probe the customer project route.
 *
 * `list_projects` / `get_project` already call `listMine` / `getMine`. This
 * tool still used staff `projects.list` as a "does this workspace have any
 * projects?" probe, which 403s for every customer credential. The probe does
 * not need instance-wide listing; a single page from `/users/me/projects/`
 * answers the same question in the caller's scope.
 *
 * Pinned as a ROUTE test rather than a behaviour test because both routes
 * return the same serializers. A mocked `projects.list` would stay green
 * after a revert; this test fails if the handler goes back to `/projects/`.
 */
import { describe, expect, it, vi } from "vitest";
import { registerStatsTools } from "../../src/tools/stats.js";

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
  const avala = {
    datasets: {
      list: async (o?: { limit?: number }) => requestPage("/datasets/", o),
    },
    projects: {
      list: async (o?: { limit?: number }) => requestPage("/projects/", o),
      listMine: async (o?: { limit?: number }) =>
        requestPage("/users/me/projects/", o),
    },
    exports: {
      list: async (o?: { limit?: number }) => requestPage("/exports/", o),
    },
  };
  registerStatsTools(server as never, (() => avala) as never);
  return { handlers, requestPage };
}

describe("get_workspace_stats calls the customer-visible project route", () => {
  it("probes /users/me/projects/, not the staff-only /projects/", async () => {
    const { handlers, requestPage } = harness();
    await handlers.get("get_workspace_stats")!({});

    expect(requestPage).toHaveBeenCalledWith(
      "/users/me/projects/",
      expect.anything(),
    );
    expect(requestPage).not.toHaveBeenCalledWith(
      "/projects/",
      expect.anything(),
    );
    expect(requestPage).toHaveBeenCalledWith("/datasets/", expect.anything());
    expect(requestPage).toHaveBeenCalledWith("/exports/", expect.anything());
  });
});
