import type { McpServer } from "@modelcontextprotocol/server";
import type { GetClient } from "../client.js";
import {
  definePageOutputSchema,
  defineReadCatalogTool,
  registerReadCatalogTool,
} from "../catalog.js";
import { z } from "zod";

import { safeStringify } from "../redact.js";

// Catalog execution sanitizes every validated result before it reaches MCP.
// Keep schemas transform-free so SDK v2 can emit standards-compliant JSON Schema.
const sanitizedRecordSchema = z.record(z.string(), z.unknown());

const fleetDeviceOutputSchema = z
  .object({
    uid: z.string(),
    name: z.string(),
    type: z.string().nullable(),
    status: z.string().nullable(),
    tags: z.array(z.string()),
    firmwareVersion: z.string().nullable(),
    metadata: sanitizedRecordSchema.nullable(),
    lastSeenAt: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  // Device list/detail deliberately omit deviceToken. Stripping unknown
  // fields preserves that boundary even if an upstream response regresses.
  .strip();

const fleetRecordingOutputSchema = z
  .object({
    uid: z.string(),
    device: z.string().nullable(),
    status: z.string().nullable(),
    durationSeconds: z.number().nullable(),
    sizeBytes: z.number().nullable(),
    topicCount: z.number(),
    tags: z.array(z.string()),
    topics: z.array(sanitizedRecordSchema).nullable(),
    startedAt: z.string().nullable(),
    endedAt: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .strip();

const fleetEventOutputSchema = z
  .object({
    uid: z.string(),
    recording: z.string().nullable(),
    device: z.string().nullable(),
    type: z.string().nullable(),
    label: z.string().nullable(),
    description: z.string().nullable(),
    timestamp: z.string().nullable(),
    durationMs: z.number().nullable(),
    tags: z.array(z.string()),
    metadata: sanitizedRecordSchema.nullable(),
    severity: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .strip();

const fleetAlertOutputSchema = z
  .object({
    uid: z.string(),
    rule: z.string().nullable(),
    device: z.string().nullable(),
    recording: z.string().nullable(),
    severity: z.string().nullable(),
    status: z.string().nullable(),
    message: z.string().nullable(),
    triggeredAt: z.string().nullable(),
    acknowledgedAt: z.string().nullable(),
    acknowledgedBy: z.string().nullable(),
    resolvedAt: z.string().nullable(),
    resolutionNote: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .strip();

const fleetRuleOutputSchema = z
  .object({
    uid: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    enabled: z.boolean(),
    condition: sanitizedRecordSchema.nullable(),
    actions: z.array(sanitizedRecordSchema),
    scope: sanitizedRecordSchema.nullable(),
    hitCount: z.number(),
    lastHitAt: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .strip();

export const FLEET_DEVICE_LIST_ROUTE = {
  name: "fleet-device-list",
  method: "GET",
  path: "/fleet/devices/",
  response: "page",
  scope: "fleet.read",
  toolset: "fleet",
} as const;

export const FLEET_RECORDING_LIST_ROUTE = {
  name: "fleet-recording-list",
  method: "GET",
  path: "/fleet/recordings/",
  response: "page",
  scope: "fleet.read",
  toolset: "fleet",
} as const;

export const FLEET_ALERT_LIST_ROUTE = {
  name: "fleet-alert-list",
  method: "GET",
  path: "/fleet/alerts/",
  response: "page",
  scope: "fleet.read",
  toolset: "fleet",
} as const;

const fleetListDevicesTool = defineReadCatalogTool({
  name: "fleet_list_devices",
  title: "List fleet devices",
  description: "List fleet devices with optional filters.",
  inputSchema: z.object({
    status: z
      .string()
      .optional()
      .describe("Filter by device status (online, offline, maintenance)"),
    type: z.string().optional().describe("Filter by device type"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of devices to return"),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor from a previous request"),
  }),
  outputSchema: definePageOutputSchema(fleetDeviceOutputSchema),
  route: {
    ...FLEET_DEVICE_LIST_ROUTE,
    query: { status: "status", type: "type", limit: "limit", cursor: "cursor" },
  },
});

const fleetGetDeviceTool = defineReadCatalogTool({
  name: "fleet_get_device",
  title: "Get fleet device",
  description: "Get detailed information about a specific fleet device.",
  inputSchema: z.object({
    uid: z.string().describe("The unique identifier of the device"),
  }),
  outputSchema: fleetDeviceOutputSchema,
  route: {
    name: "fleet-device-detail",
    method: "GET",
    path: "/fleet/devices/{uid}/",
    response: "single",
    scope: "fleet.read",
    toolset: "fleet",
  },
});

const fleetListRecordingsTool = defineReadCatalogTool({
  name: "fleet_list_recordings",
  title: "List fleet recordings",
  description: "List fleet recordings with optional filters.",
  inputSchema: z.object({
    device: z.string().optional().describe("Filter by device UID"),
    status: z.string().optional().describe("Filter by recording status"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of recordings to return"),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  outputSchema: definePageOutputSchema(fleetRecordingOutputSchema),
  route: {
    ...FLEET_RECORDING_LIST_ROUTE,
    query: {
      device: "device",
      status: "status",
      limit: "limit",
      cursor: "cursor",
    },
  },
});

const fleetGetRecordingTool = defineReadCatalogTool({
  name: "fleet_get_recording",
  title: "Get fleet recording",
  description: "Get detailed information about a specific recording.",
  inputSchema: z.object({
    uid: z.string().describe("The unique identifier of the recording"),
  }),
  outputSchema: fleetRecordingOutputSchema,
  route: {
    name: "fleet-recording-detail",
    method: "GET",
    path: "/fleet/recordings/{uid}/",
    response: "single",
    scope: "fleet.read",
    toolset: "fleet",
  },
});

const fleetListEventsTool = defineReadCatalogTool({
  name: "fleet_list_events",
  title: "List fleet events",
  description: "List fleet events with optional filters.",
  inputSchema: z.object({
    recording: z.string().optional().describe("Filter by recording UID"),
    device: z.string().optional().describe("Filter by device UID"),
    type: z.string().optional().describe("Filter by event type"),
    severity: z.string().optional().describe("Filter by severity"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of events to return"),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  outputSchema: definePageOutputSchema(fleetEventOutputSchema),
  route: {
    name: "fleet-event-list",
    method: "GET",
    path: "/fleet/events/",
    query: {
      recording: "recording",
      device: "device",
      type: "type",
      severity: "severity",
      limit: "limit",
      cursor: "cursor",
    },
    response: "page",
    scope: "fleet.read",
    toolset: "fleet",
  },
});

const fleetListAlertsTool = defineReadCatalogTool({
  name: "fleet_list_alerts",
  title: "List fleet alerts",
  description: "List fleet alerts with optional filters.",
  inputSchema: z.object({
    status: z
      .string()
      .optional()
      .describe("Filter by alert status (open, acknowledged, resolved)"),
    severity: z
      .string()
      .optional()
      .describe("Filter by severity (info, warning, error, critical)"),
    device: z.string().optional().describe("Filter by device UID"),
    rule: z.string().optional().describe("Filter by rule UID"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of alerts to return"),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  outputSchema: definePageOutputSchema(fleetAlertOutputSchema),
  route: {
    ...FLEET_ALERT_LIST_ROUTE,
    query: {
      status: "status",
      severity: "severity",
      device: "device",
      rule: "rule",
      limit: "limit",
      cursor: "cursor",
    },
  },
});

const fleetListRulesTool = defineReadCatalogTool({
  name: "fleet_list_rules",
  title: "List fleet rules",
  description: "List fleet rules with optional filters.",
  inputSchema: z.object({
    enabled: z.boolean().optional().describe("Filter by enabled status"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of rules to return"),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  outputSchema: definePageOutputSchema(fleetRuleOutputSchema),
  route: {
    name: "fleet-rule-list",
    method: "GET",
    path: "/fleet/rules/",
    query: { enabled: "enabled", limit: "limit", cursor: "cursor" },
    response: "page",
    scope: "fleet.read",
    toolset: "fleet",
  },
});

export const FLEET_READ_CATALOG_TOOLS = [
  fleetListDevicesTool,
  fleetGetDeviceTool,
  fleetListRecordingsTool,
  fleetGetRecordingTool,
  fleetListEventsTool,
  fleetListAlertsTool,
  fleetListRulesTool,
] as const;

export function registerFleetTools(
  server: McpServer,
  getClient: GetClient,
  allowMutations = false,
): void {
  registerReadCatalogTool(server, getClient, fleetListDevicesTool);
  registerReadCatalogTool(server, getClient, fleetGetDeviceTool);
  registerReadCatalogTool(server, getClient, fleetListRecordingsTool);
  registerReadCatalogTool(server, getClient, fleetGetRecordingTool);
  registerReadCatalogTool(server, getClient, fleetListEventsTool);
  registerReadCatalogTool(server, getClient, fleetListAlertsTool);
  registerReadCatalogTool(server, getClient, fleetListRulesTool);

  if (allowMutations) {
    server.registerTool(
      "fleet_register_device",
      {
        description: "Register a new fleet device.",
        inputSchema: z.object({
          name: z.string().describe("Name of the device"),
          type: z.string().describe("Type of the device"),
          firmwareVersion: z.string().optional().describe("Firmware version"),
          tags: z.array(z.string()).optional().describe("Tags for the device"),
        }),
      },
      async ({ name, type, firmwareVersion, tags }) => {
        const avala = getClient("fleet_register_device");
        const device = await avala.fleet.devices.register({
          name,
          type,
          firmwareVersion,
          tags,
        });
        // The create response is the ONLY place the caller receives the new
        // device's deviceToken (get/list omit it). Return it raw — redacting it
        // here would create a device the user cannot configure. This is a
        // user-invoked mutation, so the token is the intended result.
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(device, null, 2) },
          ],
        };
      },
    );

    server.registerTool(
      "fleet_acknowledge_alert",
      {
        description: "Acknowledge a fleet alert.",
        inputSchema: z.object({
          uid: z
            .string()
            .describe("The unique identifier of the alert to acknowledge"),
        }),
      },
      async ({ uid }) => {
        const avala = getClient("fleet_acknowledge_alert");
        const alert = await avala.fleet.alerts.acknowledge(uid);
        return {
          content: [{ type: "text" as const, text: safeStringify(alert) }],
        };
      },
    );
  }
}
