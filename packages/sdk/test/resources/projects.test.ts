import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Avala } from "../../src/client.js";

describe("projects resource", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists projects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            results: [
              {
                uid: "proj-001",
                name: "Annotation Project",
                status: "active",
                created_at: "2025-03-01T00:00:00Z",
                updated_at: "2025-03-02T00:00:00Z",
              },
            ],
            next: null,
            previous: null,
          }),
      })
    );

    const avala = new Avala({ apiKey: "test-key" });
    const page = await avala.projects.list();

    expect(page.items).toHaveLength(1);
    expect(page.items[0].name).toBe("Annotation Project");
    expect(page.items[0].status).toBe("active");
    expect(page.items[0].createdAt).toBe("2025-03-01T00:00:00Z");
    expect(page.hasMore).toBe(false);
  });

  it("gets a single project", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            uid: "proj-001",
            name: "Annotation Project",
            status: "active",
            created_at: "2025-03-01T00:00:00Z",
            updated_at: "2025-03-02T00:00:00Z",
          }),
      })
    );

    const avala = new Avala({ apiKey: "test-key" });
    const project = await avala.projects.get("proj-001");

    expect(project.uid).toBe("proj-001");
    expect(project.name).toBe("Annotation Project");
    expect(project.createdAt).toBe("2025-03-01T00:00:00Z");
  });

  it("handles pagination cursor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            results: [{ uid: "proj-001", name: "Project 1", status: "active" }],
            next: "https://api.avala.ai/api/v1/projects/?cursor=nextcur",
            previous: null,
          }),
      })
    );

    const avala = new Avala({ apiKey: "test-key" });
    const page = await avala.projects.list();

    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe("nextcur");
  });
});
