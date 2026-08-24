import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerFleetTools } from "../../src/tools/fleet.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}>;

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  return {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
    getHandler(name: string) {
      return handlers.get(name);
    },
  };
}

function createMockAvala() {
  return {
    transport: { requestPage: vi.fn(), requestSingle: vi.fn() },
    fleet: {
      devices: { register: vi.fn() },
      alerts: { acknowledge: vi.fn() },
    },
  };
}

const DEVICE = {
  uid: "device-1",
  name: "Front camera",
  type: "camera",
  status: "online",
  tags: ["warehouse"],
  firmwareVersion: "1.0.0",
  metadata: { location: "warehouse" },
  lastSeenAt: "2026-08-24T00:00:00Z",
  createdAt: "2026-08-23T00:00:00Z",
  updatedAt: "2026-08-24T00:00:00Z",
};

const RECORDING = {
  uid: "recording-1",
  device: "device-1",
  status: "ready",
  durationSeconds: 60,
  sizeBytes: 1024,
  topicCount: 2,
  tags: ["warehouse"],
  topics: [{ name: "/camera/front" }],
  startedAt: "2026-08-24T00:00:00Z",
  endedAt: "2026-08-24T00:01:00Z",
  createdAt: "2026-08-24T00:00:00Z",
  updatedAt: "2026-08-24T00:01:00Z",
};

const EVENT = {
  uid: "event-1",
  recording: "recording-1",
  device: "device-1",
  type: "hard_brake",
  label: "Hard brake",
  description: "Abrupt deceleration",
  timestamp: "2026-08-24T00:00:30Z",
  durationMs: 500,
  tags: ["safety"],
  metadata: { speedMps: 12 },
  severity: "warning",
  createdAt: "2026-08-24T00:00:30Z",
  updatedAt: "2026-08-24T00:00:30Z",
};

const ALERT = {
  uid: "alert-1",
  rule: "rule-1",
  device: "device-1",
  recording: "recording-1",
  severity: "warning",
  status: "open",
  message: "Threshold exceeded",
  triggeredAt: "2026-08-24T00:00:30Z",
  acknowledgedAt: null,
  acknowledgedBy: null,
  resolvedAt: null,
  resolutionNote: null,
  createdAt: "2026-08-24T00:00:30Z",
  updatedAt: "2026-08-24T00:00:30Z",
};

const RULE = {
  uid: "rule-1",
  name: "Hard braking",
  description: "Flag abrupt deceleration",
  enabled: true,
  condition: { type: "threshold", field: "deceleration" },
  actions: [{ type: "webhook" }],
  scope: { deviceTypes: ["camera"] },
  hitCount: 1,
  lastHitAt: "2026-08-24T00:00:30Z",
  createdAt: "2026-08-23T00:00:00Z",
  updatedAt: "2026-08-24T00:00:30Z",
};

function page(item: Record<string, unknown>) {
  return { items: [item], nextCursor: null, previousCursor: null, hasMore: false };
}

describe("fleet tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let avala: ReturnType<typeof createMockAvala>;

  beforeEach(() => {
    server = createMockServer();
    avala = createMockAvala();
    avala.transport.requestPage.mockImplementation(async (path: string) => {
      if (path === "/fleet/devices/") return page(DEVICE);
      if (path === "/fleet/recordings/") return page(RECORDING);
      if (path === "/fleet/events/") return page(EVENT);
      if (path === "/fleet/alerts/") return page(ALERT);
      return page(RULE);
    });
    avala.transport.requestSingle.mockImplementation(async (path: string) =>
      path.includes("/devices/") ? DEVICE : RECORDING,
    );
    registerFleetTools(server as never, (() => avala) as never, true);
  });

  it("registers seven declarative reads and two mutation-gated tools", () => {
    expect(server.registerTool).toHaveBeenCalledTimes(7);
    expect(server.tool).toHaveBeenCalledTimes(2);
    expect(server.getHandler("fleet_list_devices")).toBeDefined();
    expect(server.getHandler("fleet_get_device")).toBeDefined();
    expect(server.getHandler("fleet_list_recordings")).toBeDefined();
    expect(server.getHandler("fleet_get_recording")).toBeDefined();
    expect(server.getHandler("fleet_list_events")).toBeDefined();
    expect(server.getHandler("fleet_list_alerts")).toBeDefined();
    expect(server.getHandler("fleet_list_rules")).toBeDefined();
    expect(server.getHandler("fleet_register_device")).toBeDefined();
    expect(server.getHandler("fleet_acknowledge_alert")).toBeDefined();
  });

  it("dispatches every filtered list route through the declared transport", async () => {
    await server.getHandler("fleet_list_devices")!({ status: "online", type: "camera", limit: 10, cursor: "a" });
    await server.getHandler("fleet_list_recordings")!({ device: "device-1", status: "ready", limit: 20 });
    await server.getHandler("fleet_list_events")!({
      recording: "recording-1",
      device: "device-1",
      type: "hard_brake",
      severity: "warning",
      limit: 30,
    });
    await server.getHandler("fleet_list_alerts")!({
      status: "open",
      severity: "warning",
      device: "device-1",
      rule: "rule-1",
      limit: 40,
    });
    await server.getHandler("fleet_list_rules")!({ enabled: false, limit: 50 });

    expect(avala.transport.requestPage).toHaveBeenNthCalledWith(1, "/fleet/devices/", {
      status: "online",
      type: "camera",
      limit: "10",
      cursor: "a",
    });
    expect(avala.transport.requestPage).toHaveBeenNthCalledWith(2, "/fleet/recordings/", {
      device: "device-1",
      status: "ready",
      limit: "20",
    });
    expect(avala.transport.requestPage).toHaveBeenNthCalledWith(3, "/fleet/events/", {
      recording: "recording-1",
      device: "device-1",
      type: "hard_brake",
      severity: "warning",
      limit: "30",
    });
    expect(avala.transport.requestPage).toHaveBeenNthCalledWith(4, "/fleet/alerts/", {
      status: "open",
      severity: "warning",
      device: "device-1",
      rule: "rule-1",
      limit: "40",
    });
    expect(avala.transport.requestPage).toHaveBeenNthCalledWith(5, "/fleet/rules/", {
      enabled: "false",
      limit: "50",
    });
  });

  it("dispatches device and recording detail routes", async () => {
    const device = await server.getHandler("fleet_get_device")!({ uid: "device-1" });
    const recording = await server.getHandler("fleet_get_recording")!({ uid: "recording-1" });

    expect(avala.transport.requestSingle).toHaveBeenNthCalledWith(1, "/fleet/devices/device-1/");
    expect(avala.transport.requestSingle).toHaveBeenNthCalledWith(2, "/fleet/recordings/recording-1/");
    expect(device.structuredContent).toEqual(DEVICE);
    expect(recording.structuredContent).toEqual(RECORDING);
  });

  it("strips unexpected device tokens and redacts credentials nested in metadata", async () => {
    avala.transport.requestSingle.mockResolvedValueOnce({
      ...DEVICE,
      deviceToken: "FAKE-not-a-real-device-token",
      metadata: {
        aws_access_key_id: "FAKE-not-a-real-access-key-id",
        aws_session_token: "FAKE-not-a-real-session-token",
        location: "warehouse",
      },
    });

    const result = await server.getHandler("fleet_get_device")!({ uid: "device-1" });
    const output = result.structuredContent as Record<string, unknown>;
    expect(output).not.toHaveProperty("deviceToken");
    expect(output.metadata).toEqual({
      aws_access_key_id: "[redacted]",
      aws_session_token: "[redacted]",
      location: "warehouse",
    });
    expect(result.content[0]!.text).not.toContain("FAKE-not-a-real");
  });

  it("does not register fleet mutations in read-only mode", () => {
    const readOnlyServer = createMockServer();
    registerFleetTools(readOnlyServer as never, (() => avala) as never, false);

    expect(readOnlyServer.registerTool).toHaveBeenCalledTimes(7);
    expect(readOnlyServer.tool).not.toHaveBeenCalled();
    expect(readOnlyServer.getHandler("fleet_register_device")).toBeUndefined();
    expect(readOnlyServer.getHandler("fleet_acknowledge_alert")).toBeUndefined();
  });
});
