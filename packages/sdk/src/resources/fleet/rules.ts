import type { CursorPage, FleetRule } from "../../types.js";
import { BaseResource } from "../base.js";

export interface ListRulesOptions {
  enabled?: boolean;
  limit?: number;
  cursor?: string;
}

export interface CreateRuleOptions {
  name: string;
  condition: Record<string, unknown>;
  actions: Array<Record<string, unknown>>;
  description?: string;
  enabled?: boolean;
  scope?: Record<string, unknown>;
}

export interface UpdateRuleOptions {
  name?: string;
  description?: string;
  enabled?: boolean;
  condition?: Record<string, unknown>;
  actions?: Array<Record<string, unknown>>;
  scope?: Record<string, unknown>;
}

export class FleetRulesResource extends BaseResource {
  async list(options?: ListRulesOptions): Promise<CursorPage<FleetRule>> {
    const params: Record<string, string> = {};
    if (options?.enabled !== undefined) params.enabled = String(options.enabled);
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<FleetRule>("/fleet/rules/", Object.keys(params).length > 0 ? params : undefined);
  }

  async create(options: CreateRuleOptions): Promise<FleetRule> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      name: "name",
      description: "description",
      enabled: "enabled",
      condition: "condition",
      actions: "actions",
      scope: "scope",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    return this.http.requestCreate<FleetRule>("/fleet/rules/", payload);
  }

  async get(uid: string): Promise<FleetRule> {
    return this.http.requestSingle<FleetRule>(`/fleet/rules/${uid}/`);
  }

  async update(uid: string, options: UpdateRuleOptions): Promise<FleetRule> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      name: "name",
      description: "description",
      enabled: "enabled",
      condition: "condition",
      actions: "actions",
      scope: "scope",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    return this.http.requestUpdate<FleetRule>(`/fleet/rules/${uid}/`, payload);
  }

  async delete(uid: string): Promise<void> {
    await this.http.request("DELETE", `/fleet/rules/${uid}/`);
  }
}
