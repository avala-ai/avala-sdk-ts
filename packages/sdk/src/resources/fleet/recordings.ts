import type { CursorPage, FleetRecording } from "../../types.js";
import { BaseResource } from "../base.js";

export interface ListRecordingsOptions {
  device?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}

export interface UpdateRecordingOptions {
  status?: string;
  tags?: string[];
}

export class FleetRecordingsResource extends BaseResource {
  async list(options?: ListRecordingsOptions): Promise<CursorPage<FleetRecording>> {
    const params: Record<string, string> = {};
    if (options?.device) params.device = options.device;
    if (options?.status) params.status = options.status;
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<FleetRecording>("/fleet/recordings/", Object.keys(params).length > 0 ? params : undefined);
  }

  async get(uid: string): Promise<FleetRecording> {
    return this.http.requestSingle<FleetRecording>(`/fleet/recordings/${uid}/`);
  }

  async update(uid: string, options: UpdateRecordingOptions): Promise<FleetRecording> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      status: "status",
      tags: "tags",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    return this.http.requestUpdate<FleetRecording>(`/fleet/recordings/${uid}/`, payload);
  }

  async delete(uid: string): Promise<void> {
    await this.http.request("DELETE", `/fleet/recordings/${uid}/`);
  }
}
