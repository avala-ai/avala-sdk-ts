import {
  AuthenticationError,
  AvalaError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
} from "./errors.js";
import type { CursorPage, RateLimitInfo, RawPageResponse } from "./types.js";

export interface HttpConfig {
  apiKey: string;
  baseUrl: string;
  timeout: number;
}

/** Convert snake_case keys to camelCase */
function snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

function extractCursor(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("cursor");
  } catch {
    return null;
  }
}

export class HttpTransport {
  private readonly config: HttpConfig;
  private _lastRateLimit: RateLimitInfo = { limit: null, remaining: null, reset: null };

  constructor(config: HttpConfig) {
    this.config = config;
  }

  get lastRateLimit(): RateLimitInfo {
    return { ...this._lastRateLimit };
  }

  private extractRateLimitHeaders(response: Response): void {
    if (!response.headers) return;
    this._lastRateLimit = {
      limit: response.headers.get("X-RateLimit-Limit"),
      remaining: response.headers.get("X-RateLimit-Remaining"),
      reset: response.headers.get("X-RateLimit-Reset"),
    };
  }

  async request<T>(method: string, path: string, options?: { json?: unknown; params?: Record<string, string> }): Promise<T> {
    let url = `${this.config.baseUrl}${path}`;
    if (options?.params) {
      const searchParams = new URLSearchParams(options.params);
      url += `?${searchParams.toString()}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          "X-Avala-Api-Key": this.config.apiKey,
          "Accept": "application/json",
          ...(options?.json ? { "Content-Type": "application/json" } : {}),
        },
        body: options?.json ? JSON.stringify(options.json) : undefined,
        signal: controller.signal,
      });

      this.extractRateLimitHeaders(response);

      if (!response.ok) {
        await this.handleError(response);
      }

      if (response.status === 204) {
        return undefined as T;
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async requestPage<T>(path: string, params?: Record<string, string>): Promise<CursorPage<T>> {
    const raw = await this.request<RawPageResponse>("GET", path, { params });
    const items = raw.results.map((item) => snakeToCamel(item) as T);
    return {
      items,
      nextCursor: extractCursor(raw.next),
      previousCursor: extractCursor(raw.previous),
      hasMore: raw.next !== null,
    };
  }

  async requestSingle<T>(path: string): Promise<T> {
    const raw = await this.request<Record<string, unknown>>("GET", path);
    return snakeToCamel(raw) as T;
  }

  async requestCreate<T>(path: string, json: unknown): Promise<T> {
    const raw = await this.request<Record<string, unknown>>("POST", path, { json });
    return snakeToCamel(raw) as T;
  }

  private async handleError(response: Response): Promise<never> {
    let body: unknown;
    let message = `HTTP ${response.status}`;
    try {
      body = await response.json();
      if (typeof body === "object" && body !== null && "detail" in body) {
        message = (body as { detail: string }).detail;
      }
    } catch {
      // ignore JSON parse errors
    }

    const status = response.status;
    if (status === 401) throw new AuthenticationError(message, body);
    if (status === 404) throw new NotFoundError(message, body);
    if (status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      throw new RateLimitError(message, body, retryAfter ? parseFloat(retryAfter) : null);
    }
    if (status === 400 || status === 422) {
      throw new ValidationError(message, status, body);
    }
    if (status >= 500) throw new ServerError(message, status, body);
    throw new AvalaError(message, status, body);
  }
}
