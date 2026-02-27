import type { CursorPage, FleetDevice } from "../../types.js";
import { BaseResource } from "../base.js";

export interface RegisterDeviceOptions {
  name: string;
  type: string;
  firmwareVersion?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateDeviceOptions {
  name?: string;
  status?: string;
  firmwareVersion?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ListDevicesOptions {
  status?: string;
  type?: string;
  limit?: number;
  cursor?: string;
}

export class FleetDevicesResource extends BaseResource {
  async list(options?: ListDevicesOptions): Promise<CursorPage<FleetDevice>> {
    const params: Record<string, string> = {};
    if (options?.status) params.status = options.status;
    if (options?.type) params.type = options.type;
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<FleetDevice>("/fleet/devices/", Object.keys(params).length > 0 ? params : undefined);
  }

  async register(options: RegisterDeviceOptions): Promise<FleetDevice> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      name: "name",
      type: "type",
      firmwareVersion: "firmware_version",
      tags: "tags",
      metadata: "metadata",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    return this.http.requestCreate<FleetDevice>("/fleet/devices/", payload);
  }

  async get(uid: string): Promise<FleetDevice> {
    return this.http.requestSingle<FleetDevice>(`/fleet/devices/${uid}/`);
  }

  async update(uid: string, options: UpdateDeviceOptions): Promise<FleetDevice> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      name: "name",
      status: "status",
      firmwareVersion: "firmware_version",
      tags: "tags",
      metadata: "metadata",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    return this.http.requestUpdate<FleetDevice>(`/fleet/devices/${uid}/`, payload);
  }

  async delete(uid: string): Promise<void> {
    await this.http.request("DELETE", `/fleet/devices/${uid}/`);
  }
}
