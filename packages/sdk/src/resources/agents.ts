import type { Agent, AgentExecution, CursorPage } from "../types.js";
import { BaseResource } from "./base.js";

export interface CreateAgentOptions {
  name: string;
  description?: string;
  callbackUrl?: string;
  events: string[];
  project?: string;
  taskTypes?: string[];
}

export interface UpdateAgentOptions {
  name?: string;
  description?: string;
  callbackUrl?: string;
  events?: string[];
  isActive?: boolean;
  project?: string;
  taskTypes?: string[];
}

export class AgentsResource extends BaseResource {
  async list(options?: { limit?: number; cursor?: string }): Promise<CursorPage<Agent>> {
    const params: Record<string, string> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<Agent>("/agents/", Object.keys(params).length > 0 ? params : undefined);
  }

  async create(options: CreateAgentOptions): Promise<Agent> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      name: "name",
      description: "description",
      callbackUrl: "callback_url",
      events: "events",
      project: "project",
      taskTypes: "task_types",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    return this.http.requestCreate<Agent>("/agents/", payload);
  }

  async get(uid: string): Promise<Agent> {
    return this.http.requestSingle<Agent>(`/agents/${uid}/`);
  }

  async update(uid: string, options: UpdateAgentOptions): Promise<Agent> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      name: "name",
      description: "description",
      callbackUrl: "callback_url",
      events: "events",
      isActive: "is_active",
      project: "project",
      taskTypes: "task_types",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    return this.http.requestUpdate<Agent>(`/agents/${uid}/`, payload);
  }

  async delete(uid: string): Promise<void> {
    await this.http.request("DELETE", `/agents/${uid}/`);
  }

  async listExecutions(uid: string, options?: { limit?: number; cursor?: string }): Promise<CursorPage<AgentExecution>> {
    const params: Record<string, string> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<AgentExecution>(`/agents/${uid}/executions/`, Object.keys(params).length > 0 ? params : undefined);
  }

  async test(uid: string): Promise<{ success: boolean }> {
    return this.http.request("POST", `/agents/${uid}/test/`);
  }
}
