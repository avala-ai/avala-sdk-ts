import { describe, it, expect, vi, afterEach } from "vitest";
import { Avala } from "../../src/client.js";

describe("tasks resource", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists tasks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            results: [
              {
                uid: "task-001",
                type: "annotation",
                name: "Label images",
                status: "active",
                project: "proj-001",
                created_at: "2025-05-01T00:00:00Z",
                updated_at: "2025-05-02T00:00:00Z",
              },
            ],
            next: null,
            previous: null,
          }),
      })
    );

    const avala = new Avala({ apiKey: "test-key" });
    const page = await avala.tasks.list();

    expect(page.items).toHaveLength(1);
    expect(page.items[0].name).toBe("Label images");
    expect(page.items[0].status).toBe("active");
    expect(page.items[0].createdAt).toBe("2025-05-01T00:00:00Z");
    expect(page.hasMore).toBe(false);
  });

  it("gets a single task", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            uid: "task-001",
            type: "annotation",
            name: "Label images",
            status: "active",
            project: "proj-001",
            created_at: "2025-05-01T00:00:00Z",
            updated_at: "2025-05-02T00:00:00Z",
          }),
      })
    );

    const avala = new Avala({ apiKey: "test-key" });
    const task = await avala.tasks.get("task-001");

    expect(task.uid).toBe("task-001");
    expect(task.type).toBe("annotation");
    expect(task.project).toBe("proj-001");
  });

  it("filters tasks by project", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            results: [{ uid: "task-001", name: "Task 1", project: "proj-001" }],
            next: null,
            previous: null,
          }),
      })
    );

    const avala = new Avala({ apiKey: "test-key" });
    await avala.tasks.list({ project: "proj-001" });

    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain("project=proj-001");
  });

  it("filters tasks by status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            results: [{ uid: "task-002", name: "Task 2", status: "completed" }],
            next: null,
            previous: null,
          }),
      })
    );

    const avala = new Avala({ apiKey: "test-key" });
    await avala.tasks.list({ status: "completed" });

    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain("status=completed");
  });
});
