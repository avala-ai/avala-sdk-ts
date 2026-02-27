import type { CursorPage, FleetAlert, FleetAlertChannel } from "../../types.js";
import { BaseResource } from "../base.js";

export interface ListAlertsOptions {
  status?: string;
  severity?: string;
  device?: string;
  rule?: string;
  limit?: number;
  cursor?: string;
}

export interface ResolveAlertOptions {
  resolutionNote?: string;
}

export class FleetAlertsResource extends BaseResource {
  async list(options?: ListAlertsOptions): Promise<CursorPage<FleetAlert>> {
    const params: Record<string, string> = {};
    if (options?.status) params.status = options.status;
    if (options?.severity) params.severity = options.severity;
    if (options?.device) params.device = options.device;
    if (options?.rule) params.rule = options.rule;
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<FleetAlert>("/fleet/alerts/", Object.keys(params).length > 0 ? params : undefined);
  }

  async get(uid: string): Promise<FleetAlert> {
    return this.http.requestSingle<FleetAlert>(`/fleet/alerts/${uid}/`);
  }

  async acknowledge(uid: string): Promise<FleetAlert> {
    return this.http.requestCreate<FleetAlert>(`/fleet/alerts/${uid}/acknowledge/`, {});
  }

  async resolve(uid: string, options?: ResolveAlertOptions): Promise<FleetAlert> {
    const payload: Record<string, unknown> = {};
    if (options?.resolutionNote !== undefined) payload.resolution_note = options.resolutionNote;
    return this.http.requestCreate<FleetAlert>(`/fleet/alerts/${uid}/resolve/`, payload);
  }
}

export interface CreateAlertChannelOptions {
  name: string;
  type: string;
  config: Record<string, unknown>;
}

export class FleetAlertChannelsResource extends BaseResource {
  async list(options?: { limit?: number; cursor?: string }): Promise<CursorPage<FleetAlertChannel>> {
    const params: Record<string, string> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<FleetAlertChannel>("/fleet/alert-channels/", Object.keys(params).length > 0 ? params : undefined);
  }

  async create(options: CreateAlertChannelOptions): Promise<FleetAlertChannel> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      name: "name",
      type: "type",
      config: "config",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    return this.http.requestCreate<FleetAlertChannel>("/fleet/alert-channels/", payload);
  }

  async delete(uid: string): Promise<void> {
    await this.http.request("DELETE", `/fleet/alert-channels/${uid}/`);
  }

  async test(uid: string): Promise<{ detail: string; channel_uid: string; channel_type: string }> {
    return this.http.request("POST", `/fleet/alert-channels/${uid}/test/`);
  }
}
