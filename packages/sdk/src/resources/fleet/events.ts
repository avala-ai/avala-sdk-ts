import type { CursorPage, FleetEvent } from "../../types.js";
import { BaseResource } from "../base.js";

export interface ListEventsOptions {
  recording?: string;
  device?: string;
  type?: string;
  severity?: string;
  limit?: number;
  cursor?: string;
}

export interface CreateEventOptions {
  recording: string;
  device: string;
  label: string;
  type: string;
  timestamp: string;
  description?: string;
  durationMs?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  severity?: string;
}

export class FleetEventsResource extends BaseResource {
  async list(options?: ListEventsOptions): Promise<CursorPage<FleetEvent>> {
    const params: Record<string, string> = {};
    if (options?.recording) params.recording = options.recording;
    if (options?.device) params.device = options.device;
    if (options?.type) params.type = options.type;
    if (options?.severity) params.severity = options.severity;
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<FleetEvent>("/fleet/events/", Object.keys(params).length > 0 ? params : undefined);
  }

  async create(options: CreateEventOptions): Promise<FleetEvent> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      recording: "recording",
      device: "device",
      type: "type",
      label: "label",
      description: "description",
      timestamp: "timestamp",
      durationMs: "duration_ms",
      tags: "tags",
      metadata: "metadata",
      severity: "severity",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    return this.http.requestCreate<FleetEvent>("/fleet/events/", payload);
  }

  async createBatch(events: CreateEventOptions[]): Promise<{ created: number }> {
    const keyMap: Record<string, string> = {
      recording: "recording",
      device: "device",
      type: "type",
      label: "label",
      description: "description",
      timestamp: "timestamp",
      durationMs: "duration_ms",
      tags: "tags",
      metadata: "metadata",
      severity: "severity",
    };
    const payloadItems = events.map((options) => {
      const payload: Record<string, unknown> = {};
      for (const [camel, snake] of Object.entries(keyMap)) {
        const value = (options as unknown as Record<string, unknown>)[camel];
        if (value !== undefined) payload[snake] = value;
      }
      return payload;
    });
    return this.http.requestCreate<{ created: number }>("/fleet/events/batch/", { events: payloadItems });
  }

  async get(uid: string): Promise<FleetEvent> {
    return this.http.requestSingle<FleetEvent>(`/fleet/events/${uid}/`);
  }

  async delete(uid: string): Promise<void> {
    await this.http.request("DELETE", `/fleet/events/${uid}/`);
  }
}
