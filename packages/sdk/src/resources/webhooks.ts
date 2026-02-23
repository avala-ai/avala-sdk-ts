import type { CursorPage, Webhook, WebhookDelivery } from "../types.js";
import { BaseResource } from "./base.js";

export interface CreateWebhookOptions {
  targetUrl: string;
  events: string[];
  isActive?: boolean;
}

export interface UpdateWebhookOptions {
  targetUrl?: string;
  events?: string[];
  isActive?: boolean;
}

export class WebhooksResource extends BaseResource {
  async list(options?: { limit?: number; cursor?: string }): Promise<CursorPage<Webhook>> {
    const params: Record<string, string> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<Webhook>("/webhooks/", Object.keys(params).length > 0 ? params : undefined);
  }

  async create(options: CreateWebhookOptions): Promise<Webhook> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      targetUrl: "target_url",
      events: "events",
      isActive: "is_active",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    return this.http.requestCreate<Webhook>("/webhooks/", payload);
  }

  async get(uid: string): Promise<Webhook> {
    return this.http.requestSingle<Webhook>(`/webhooks/${uid}/`);
  }

  async update(uid: string, options: UpdateWebhookOptions): Promise<Webhook> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      targetUrl: "target_url",
      events: "events",
      isActive: "is_active",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    const raw = await this.http.request<Record<string, unknown>>("PATCH", `/webhooks/${uid}/`, { json: payload });
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      result[camelKey] = value;
    }
    return result as unknown as Webhook;
  }

  async delete(uid: string): Promise<void> {
    await this.http.request("DELETE", `/webhooks/${uid}/`);
  }

  async test(uid: string): Promise<{ success: boolean }> {
    return this.http.request("POST", `/webhooks/${uid}/test/`);
  }
}

export class WebhookDeliveriesResource extends BaseResource {
  async list(options?: { limit?: number; cursor?: string }): Promise<CursorPage<WebhookDelivery>> {
    const params: Record<string, string> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<WebhookDelivery>("/webhook-deliveries/", Object.keys(params).length > 0 ? params : undefined);
  }

  async get(uid: string): Promise<WebhookDelivery> {
    return this.http.requestSingle<WebhookDelivery>(`/webhook-deliveries/${uid}/`);
  }
}
