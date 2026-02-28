import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Avala } from "@avala-ai/sdk";
import { z } from "zod";

export function registerFleetTools(server: McpServer, avala: Avala, allowMutations = false): void {
  server.tool(
    "fleet_list_devices",
    "List fleet devices with optional filters.",
    {
      status: z.string().optional().describe("Filter by device status (online, offline, maintenance)"),
      type: z.string().optional().describe("Filter by device type"),
      limit: z.number().optional().describe("Maximum number of devices to return"),
      cursor: z.string().optional().describe("Pagination cursor from a previous request"),
    },
    async ({ status, type, limit, cursor }) => {
      const page = await avala.fleet.devices.list({ status, type, limit, cursor });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(page, null, 2) }],
      };
    }
  );

  server.tool(
    "fleet_get_device",
    "Get detailed information about a specific fleet device.",
    {
      uid: z.string().describe("The unique identifier of the device"),
    },
    async ({ uid }) => {
      const device = await avala.fleet.devices.get(uid);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(device, null, 2) }],
      };
    }
  );

  server.tool(
    "fleet_list_recordings",
    "List fleet recordings with optional filters.",
    {
      device: z.string().optional().describe("Filter by device UID"),
      status: z.string().optional().describe("Filter by recording status"),
      limit: z.number().optional().describe("Maximum number of recordings to return"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async ({ device, status, limit, cursor }) => {
      const page = await avala.fleet.recordings.list({ device, status, limit, cursor });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(page, null, 2) }],
      };
    }
  );

  server.tool(
    "fleet_get_recording",
    "Get detailed information about a specific recording.",
    {
      uid: z.string().describe("The unique identifier of the recording"),
    },
    async ({ uid }) => {
      const recording = await avala.fleet.recordings.get(uid);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(recording, null, 2) }],
      };
    }
  );

  server.tool(
    "fleet_list_events",
    "List fleet events with optional filters.",
    {
      recording: z.string().optional().describe("Filter by recording UID"),
      device: z.string().optional().describe("Filter by device UID"),
      type: z.string().optional().describe("Filter by event type"),
      severity: z.string().optional().describe("Filter by severity"),
      limit: z.number().optional().describe("Maximum number of events to return"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async ({ recording, device, type, severity, limit, cursor }) => {
      const page = await avala.fleet.events.list({ recording, device, type, severity, limit, cursor });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(page, null, 2) }],
      };
    }
  );

  server.tool(
    "fleet_list_alerts",
    "List fleet alerts with optional filters.",
    {
      status: z.string().optional().describe("Filter by alert status (open, acknowledged, resolved)"),
      severity: z.string().optional().describe("Filter by severity (info, warning, error, critical)"),
      device: z.string().optional().describe("Filter by device UID"),
      rule: z.string().optional().describe("Filter by rule UID"),
      limit: z.number().optional().describe("Maximum number of alerts to return"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async ({ status, severity, device, rule, limit, cursor }) => {
      const page = await avala.fleet.alerts.list({ status, severity, device, rule, limit, cursor });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(page, null, 2) }],
      };
    }
  );

  server.tool(
    "fleet_list_rules",
    "List fleet rules with optional filters.",
    {
      enabled: z.boolean().optional().describe("Filter by enabled status"),
      limit: z.number().optional().describe("Maximum number of rules to return"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async ({ enabled, limit, cursor }) => {
      const page = await avala.fleet.rules.list({ enabled, limit, cursor });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(page, null, 2) }],
      };
    }
  );

  if (allowMutations) {
    server.tool(
      "fleet_register_device",
      "Register a new fleet device.",
      {
        name: z.string().describe("Name of the device"),
        type: z.string().describe("Type of the device"),
        firmwareVersion: z.string().optional().describe("Firmware version"),
        tags: z.array(z.string()).optional().describe("Tags for the device"),
      },
      async ({ name, type, firmwareVersion, tags }) => {
        const device = await avala.fleet.devices.register({ name, type, firmwareVersion, tags });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(device, null, 2) }],
        };
      }
    );

    server.tool(
      "fleet_acknowledge_alert",
      "Acknowledge a fleet alert.",
      {
        uid: z.string().describe("The unique identifier of the alert to acknowledge"),
      },
      async ({ uid }) => {
        const alert = await avala.fleet.alerts.acknowledge(uid);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(alert, null, 2) }],
        };
      }
    );
  }
}
