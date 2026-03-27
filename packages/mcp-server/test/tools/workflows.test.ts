import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerWorkflowTools } from "../../src/tools/workflows.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[] }>;

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  return {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
    getHandler(name: string) {
      return handlers.get(name);
    },
  };
}

function createMockAvala() {
  return {
    datasets: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
    },
    projects: {
      list: vi.fn(),
      get: vi.fn(),
    },
    exports: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
    },
    organizations: {
      list: vi.fn(),
    },
    fleet: {
      devices: { list: vi.fn() },
      alerts: { list: vi.fn() },
      recordings: { list: vi.fn() },
    },
    qualityTargets: {
      list: vi.fn(),
    },
    consensus: {
      getSummary: vi.fn(),
    },
  };
}

describe("workflow tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
  });

  describe("with allowMutations = true", () => {
    beforeEach(() => {
      registerWorkflowTools(server as never, avala as never, true);
    });

    it("registers all workflow tools including mutation tools", () => {
      expect(server.getHandler("create_annotation_pipeline")).toBeDefined();
      expect(server.getHandler("get_fleet_health")).toBeDefined();
      expect(server.getHandler("get_project_quality_summary")).toBeDefined();
      expect(server.getHandler("get_workspace_overview")).toBeDefined();
    });

    it("create_annotation_pipeline creates dataset only when no projectUid", async () => {
      const mockDataset = { uid: "ds-1", name: "Test", slug: "test", dataType: "lidar" };
      avala.datasets.create.mockResolvedValue(mockDataset);

      const handler = server.getHandler("create_annotation_pipeline")!;
      const result = await handler({ name: "Test", slug: "test", dataType: "lidar" });

      expect(avala.datasets.create).toHaveBeenCalledWith({ name: "Test", slug: "test", dataType: "lidar" });
      expect(avala.exports.create).not.toHaveBeenCalled();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.dataset.uid).toBe("ds-1");
      expect(parsed.export).toBeUndefined();
    });

    it("create_annotation_pipeline creates dataset and export when projectUid provided", async () => {
      const mockDataset = { uid: "ds-1", name: "Test", slug: "test", dataType: "image" };
      const mockExport = { uid: "exp-1", status: "pending" };
      avala.datasets.create.mockResolvedValue(mockDataset);
      avala.exports.create.mockResolvedValue(mockExport);

      const handler = server.getHandler("create_annotation_pipeline")!;
      const result = await handler({ name: "Test", slug: "test", dataType: "image", projectUid: "proj-1" });

      expect(avala.datasets.create).toHaveBeenCalled();
      expect(avala.exports.create).toHaveBeenCalledWith({ project: "proj-1" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.dataset.uid).toBe("ds-1");
      expect(parsed.export.uid).toBe("exp-1");
      expect(parsed.export.status).toBe("pending");
    });
  });

  describe("with allowMutations = false", () => {
    beforeEach(() => {
      registerWorkflowTools(server as never, avala as never, false);
    });

    it("does not register create_annotation_pipeline without allowMutations", () => {
      expect(server.getHandler("create_annotation_pipeline")).toBeUndefined();
    });

    it("registers read-only workflow tools", () => {
      expect(server.getHandler("get_fleet_health")).toBeDefined();
      expect(server.getHandler("get_project_quality_summary")).toBeDefined();
      expect(server.getHandler("get_workspace_overview")).toBeDefined();
    });
  });

  describe("get_fleet_health", () => {
    beforeEach(() => {
      registerWorkflowTools(server as never, avala as never, false);
    });

    it("returns aggregated fleet health summary", async () => {
      avala.fleet.devices.list.mockResolvedValue({
        items: [
          { uid: "d-1", status: "online" },
          { uid: "d-2", status: "online" },
          { uid: "d-3", status: "offline" },
          { uid: "d-4", status: "maintenance" },
        ],
        nextCursor: null,
        hasMore: false,
      });
      avala.fleet.alerts.list.mockResolvedValue({
        items: [
          { uid: "a-1", severity: "critical" },
          { uid: "a-2", severity: "warning" },
          { uid: "a-3", severity: "critical" },
        ],
        nextCursor: null,
        hasMore: false,
      });
      avala.fleet.recordings.list.mockResolvedValue({
        items: [{ uid: "r-1" }, { uid: "r-2" }],
        nextCursor: null,
        hasMore: false,
      });

      const handler = server.getHandler("get_fleet_health")!;
      const result = await handler({});

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.devices.total).toBe(4);
      expect(parsed.devices.online).toBe(2);
      expect(parsed.devices.offline).toBe(1);
      expect(parsed.devices.maintenance).toBe(1);
      expect(parsed.alerts.totalOpen).toBe(3);
      expect(parsed.alerts.bySeverity.critical).toBe(2);
      expect(parsed.alerts.bySeverity.warning).toBe(1);
      expect(parsed.recordings.recentCount).toBe(2);
    });

    it("passes deviceType filter to devices list", async () => {
      avala.fleet.devices.list.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
      avala.fleet.alerts.list.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
      avala.fleet.recordings.list.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });

      const handler = server.getHandler("get_fleet_health")!;
      await handler({ deviceType: "robot" });

      expect(avala.fleet.devices.list).toHaveBeenCalledWith({ type: "robot", limit: 100 });
    });
  });

  describe("get_project_quality_summary", () => {
    beforeEach(() => {
      registerWorkflowTools(server as never, avala as never, false);
    });

    it("returns combined project, quality targets, and consensus data", async () => {
      avala.projects.get.mockResolvedValue({ uid: "proj-1", name: "My Project", status: "active" });
      avala.qualityTargets.list.mockResolvedValue({
        items: [
          { uid: "qt-1", name: "Accuracy", metric: "accuracy", threshold: 0.95, operator: "gte", isBreached: false, lastValue: 0.97, severity: "high" },
          { uid: "qt-2", name: "Speed", metric: "latency", threshold: 100, operator: "lte", isBreached: true, lastValue: 150, severity: "critical" },
        ],
        nextCursor: null,
        hasMore: false,
      });
      avala.consensus.getSummary.mockResolvedValue({
        meanScore: 0.85,
        medianScore: 0.88,
        minScore: 0.5,
        maxScore: 1.0,
        totalItems: 200,
        itemsWithConsensus: 180,
      });

      const handler = server.getHandler("get_project_quality_summary")!;
      const result = await handler({ projectUid: "proj-1" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.project.name).toBe("My Project");
      expect(parsed.project.status).toBe("active");
      expect(parsed.qualityTargets.total).toBe(2);
      expect(parsed.qualityTargets.breached).toBe(1);
      expect(parsed.qualityTargets.targets[0].name).toBe("Accuracy");
      expect(parsed.qualityTargets.targets[1].isBreached).toBe(true);
      expect(parsed.consensus.meanScore).toBe(0.85);
    });
  });

  describe("get_workspace_overview", () => {
    beforeEach(() => {
      registerWorkflowTools(server as never, avala as never, false);
    });

    it("returns combined workspace data from all resources", async () => {
      avala.organizations.list.mockResolvedValue({
        items: [{ uid: "org-1", name: "Acme", slug: "acme", memberCount: 5, datasetCount: 10, projectCount: 3 }],
        nextCursor: null,
        hasMore: false,
      });
      avala.datasets.list.mockResolvedValue({
        items: [{ uid: "ds-1", name: "LiDAR Set", dataType: "lidar", itemCount: 500 }],
        nextCursor: null,
        hasMore: false,
      });
      avala.projects.list.mockResolvedValue({
        items: [{ uid: "proj-1", name: "Detection", status: "active" }],
        nextCursor: null,
        hasMore: false,
      });
      avala.exports.list.mockResolvedValue({
        items: [{ uid: "exp-1", status: "completed", createdAt: "2026-03-01T00:00:00Z" }],
        nextCursor: null,
        hasMore: false,
      });

      const handler = server.getHandler("get_workspace_overview")!;
      const result = await handler({});

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.organizations).toHaveLength(1);
      expect(parsed.organizations[0].name).toBe("Acme");
      expect(parsed.recentDatasets).toHaveLength(1);
      expect(parsed.recentDatasets[0].dataType).toBe("lidar");
      expect(parsed.recentProjects).toHaveLength(1);
      expect(parsed.recentProjects[0].status).toBe("active");
      expect(parsed.recentExports).toHaveLength(1);
      expect(parsed.recentExports[0].status).toBe("completed");
    });
  });
});
