import {
  AuthenticationError,
  AvalaError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
} from "./errors.js";
import { redact, redactString } from "./redaction.js";
import type { CursorPage, RateLimitInfo, RawPageResponse } from "./types.js";

interface HttpConnectionConfig {
  baseUrl: string;
  timeout: number;
  clientName?: string;
  internalClientSecret?: string;
  forwardedClientIp?: string;
  mcpSubjectTokenIssuedAt?: number;
}

export type HttpConfig = HttpConnectionConfig &
  (
    | { apiKey: string; accessToken?: never }
    | { apiKey?: never; accessToken: string }
  );

const CLIENT_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const INTERNAL_CLIENT_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,512}$/;
// RFC 6750 b64token grammar. Bounding the value keeps one credential from
// turning into an oversized downstream request header.
const ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9\-._~+/]+=*$/;
const MAX_ACCESS_TOKEN_BYTES = 16 * 1024;
const MAX_FORWARDED_CLIENT_IP_LENGTH = 64;
const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

export interface HttpRequestOptions {
  json?: unknown;
  params?: Record<string, string>;
  /** Canonical UUIDv4 for one reviewed retry-safe mutation. */
  idempotencyKey?: string;
}

/** Validate the exact key format enforced by Django's hosted-MCP boundary. */
export function validateIdempotencyKey(
  value: unknown,
): asserts value is string | undefined {
  if (value === undefined) return;
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new Error("idempotencyKey must be a canonical lowercase UUIDv4.");
  }
}

/** Validate a JWT NumericDate that can be rendered as one canonical header. */
export function validateMcpSubjectTokenIssuedAt(value: unknown): asserts value is number | undefined {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error("mcpSubjectTokenIssuedAt must be a positive safe-integer Unix timestamp.");
  }
}

/** Validate one canonical, bounded RFC 6750 bearer token value. */
export function validateAccessToken(value: unknown): asserts value is string {
  if (typeof value !== "string" || !ACCESS_TOKEN_PATTERN.test(value) || value.length > MAX_ACCESS_TOKEN_BYTES) {
    throw new Error("accessToken must be a canonical RFC 6750 bearer token no larger than 16 KiB.");
  }
}

/** Validate a service credential as one canonical HTTP header value. */
export function validateInternalClientSecret(value: string | undefined, options: { required?: boolean } = {}): void {
  if (value === undefined || value === "") {
    if (options.required) {
      throw new Error("internalClientSecret must contain 32-512 URL-safe ASCII characters.");
    }
    return;
  }
  if (!INTERNAL_CLIENT_SECRET_PATTERN.test(value)) {
    throw new Error("internalClientSecret must contain 32-512 URL-safe ASCII characters.");
  }
}

function isCanonicalIpv4(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every(
      (part) =>
        /^(0|[1-9][0-9]{0,2})$/.test(part) &&
        Number.parseInt(part, 10) <= 255,
    )
  );
}

function isIpv6(value: string): boolean {
  if (!value.includes(":") || value.includes("%")) return false;
  try {
    // WHATWG URL parsing validates the complete bracketed IPv6 literal and
    // rejects trailing data, proxy lists, zone identifiers, and bad groups.
    const parsed = new URL(`http://[${value}]/`);
    return parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]");
  } catch {
    return false;
  }
}

/** Validate one exact IPv4/IPv6 header value, never a proxy chain. */
export function validateForwardedClientIp(value: string | undefined, options: { required?: boolean } = {}): void {
  if (value === undefined || value === "") {
    if (options.required) {
      throw new Error("forwardedClientIp must contain one valid IPv4 or IPv6 address.");
    }
    return;
  }
  if (
    value.length > MAX_FORWARDED_CLIENT_IP_LENGTH ||
    value !== value.trim() ||
    (!isCanonicalIpv4(value) && !isIpv6(value))
  ) {
    throw new Error("forwardedClientIp must contain one valid IPv4 or IPv6 address.");
  }
}

/** A forwarded identity is meaningful only with trusted service provenance. */
export function validateInternalClientContext(
  internalClientSecret: string | undefined,
  forwardedClientIp: string | undefined,
): void {
  validateInternalClientSecret(internalClientSecret);
  validateForwardedClientIp(forwardedClientIp);
  if (forwardedClientIp && !internalClientSecret) {
    throw new Error("forwardedClientIp requires internalClientSecret.");
  }
}

/** Convert snake_case keys to camelCase (deep — recurses into nested objects and arrays) */
export function snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    result[camelKey] = convertValue(value);
  }
  return result;
}

function convertValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map(convertValue);
  }
  if (typeof value === "object" && value.constructor === Object) {
    return snakeToCamel(value as Record<string, unknown>);
  }
  return value;
}

function extractCursor(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    // Support both cursor-based and page-number pagination
    return parsed.searchParams.get("cursor") ?? parsed.searchParams.get("page");
  } catch {
    return null;
  }
}

export class HttpTransport {
  private readonly config: HttpConnectionConfig;
  private readonly credentialHeaders: Readonly<Record<string, string>>;
  private _lastRateLimit: RateLimitInfo = { limit: null, remaining: null, reset: null };

  constructor(config: HttpConfig) {
    // Treat the presence of each credential field as the discriminant, then
    // validate the selected value. This keeps runtime JavaScript callers from
    // creating an ambiguous object such as { apiKey: "...", accessToken: "" }
    // that validates as API-key mode but later sends an empty Bearer header.
    const hasApiKeyField = config.apiKey !== undefined;
    const hasAccessTokenField = config.accessToken !== undefined;
    if (hasApiKeyField === hasAccessTokenField) {
      throw new Error("Provide exactly one of apiKey or accessToken.");
    }
    if (hasApiKeyField && (typeof config.apiKey !== "string" || config.apiKey === "")) {
      throw new Error("apiKey must be a non-empty string.");
    }
    if (hasAccessTokenField) validateAccessToken(config.accessToken);
    if (config.clientName !== undefined && !CLIENT_NAME_PATTERN.test(config.clientName)) {
      throw new Error("clientName must match ^[a-z][a-z0-9_]{0,63}$.");
    }
    validateInternalClientContext(config.internalClientSecret, config.forwardedClientIp);
    validateMcpSubjectTokenIssuedAt(config.mcpSubjectTokenIssuedAt);
    if (
      config.mcpSubjectTokenIssuedAt !== undefined &&
      (!hasAccessTokenField || !config.internalClientSecret || !config.forwardedClientIp)
    ) {
      throw new Error("mcpSubjectTokenIssuedAt requires accessToken, internalClientSecret, and forwardedClientIp.");
    }
    this.config = {
      baseUrl: config.baseUrl,
      timeout: config.timeout,
      clientName: config.clientName,
      internalClientSecret: config.internalClientSecret,
      forwardedClientIp: config.forwardedClientIp,
      mcpSubjectTokenIssuedAt: config.mcpSubjectTokenIssuedAt,
    };
    this.credentialHeaders = hasAccessTokenField
      ? { Authorization: `Bearer ${config.accessToken as string}` }
      : { "X-Avala-Api-Key": config.apiKey as string };
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

  async request<T>(
    method: string,
    path: string,
    options?: HttpRequestOptions,
  ): Promise<T> {
    validateIdempotencyKey(options?.idempotencyKey);
    if (
      options?.idempotencyKey !== undefined &&
      SAFE_HTTP_METHODS.has(method.toUpperCase())
    ) {
      throw new Error("idempotencyKey is valid only for mutation requests.");
    }
    const url = this.buildUrl(path, options?.params);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          ...this.credentialHeaders,
          ...(this.config.clientName ? { "X-Avala-Client": this.config.clientName } : {}),
          ...(this.config.internalClientSecret
            ? { "X-Avala-Internal-Client": this.config.internalClientSecret }
            : {}),
          ...(this.config.forwardedClientIp
            ? { "X-Avala-Forwarded-Client-IP": this.config.forwardedClientIp }
            : {}),
          ...(this.config.mcpSubjectTokenIssuedAt !== undefined
            ? { "X-Avala-OAuth-Subject-Iat": String(this.config.mcpSubjectTokenIssuedAt) }
            : {}),
          ...(options?.idempotencyKey
            ? { "Idempotency-Key": options.idempotencyKey }
            : {}),
          "Accept": "application/json",
          ...(options?.json ? { "Content-Type": "application/json" } : {}),
        },
        body: options?.json ? JSON.stringify(options.json) : undefined,
        signal: controller.signal,
        // Never follow redirects. Fetch may replay non-Authorization headers
        // such as X-Avala-Api-Key across origins, and relying on runtime rules
        // for bearer stripping would make the two credential modes diverge.
        redirect: "manual",
      });

      if (response.status >= 300 && response.status < 400) {
        throw new AvalaError(
          `Unexpected redirect (HTTP ${response.status}) from ${url}. The SDK does not follow redirects to avoid leaking credentials.`,
          response.status,
          null,
        );
      }

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

  private buildUrl(path: string, params?: Record<string, string>): string {
    if (!path.startsWith("/")) {
      throw new Error("Path must start with '/'.");
    }
    if (path.startsWith("//") || path.startsWith("http://") || path.startsWith("https://")) {
      throw new Error("Path must be a relative API path.");
    }
    if (path.includes("\r") || path.includes("\n")) {
      throw new Error("Path must not contain control characters.");
    }

    // Defense-in-depth against path-traversal pivots via unescaped resource
    // identifiers. Resource classes interpolate caller-supplied values (UIDs,
    // slugs, owner names) into URL paths; a malicious value like "../admin"
    // could otherwise reach a different endpoint. Reject the traversal markers
    // here rather than auditing every interpolation site.
    const pathOnly = path.split("?", 1)[0] ?? path;
    const lowered = pathOnly.toLowerCase();
    if (lowered.includes("://")) {
      throw new Error("Path must not contain a URL scheme.");
    }
    if (pathOnly.includes("/../") || pathOnly.endsWith("/..") || pathOnly.includes("/./")) {
      throw new Error("Path must not contain traversal segments.");
    }
    if (lowered.includes("%2e%2e") || lowered.includes("%2f%2e%2e")) {
      throw new Error("Path must not contain URL-encoded traversal segments.");
    }
    if (pathOnly.slice(1).includes("//")) {
      throw new Error("Path must not contain '//' segments.");
    }

    let url = `${this.config.baseUrl}${path}`;
    if (!params) {
      return url;
    }

    const searchParams = new URLSearchParams(params);
    return `${url}?${searchParams.toString()}`;
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

  async requestList<T>(path: string, params?: Record<string, string>): Promise<T[]> {
    const raw = await this.request<Record<string, unknown>[]>("GET", path, { params });
    return raw.map((item) => snakeToCamel(item) as T);
  }

  async requestSingle<T>(path: string, params?: Record<string, string>): Promise<T> {
    const raw = await this.request<Record<string, unknown>>("GET", path, { params });
    return snakeToCamel(raw) as T;
  }

  async requestCreate<T>(
    path: string,
    json: unknown,
    options?: Pick<HttpRequestOptions, "idempotencyKey">,
  ): Promise<T> {
    const raw = await this.request<Record<string, unknown>>("POST", path, {
      json,
      ...options,
    });
    return snakeToCamel(raw) as T;
  }

  async requestUpdate<T>(path: string, json: unknown): Promise<T> {
    const raw = await this.request<Record<string, unknown>>("PATCH", path, { json });
    return snakeToCamel(raw) as T;
  }

  async requestPut<T>(path: string, json: unknown): Promise<T> {
    const raw = await this.request<Record<string, unknown>>("PUT", path, { json });
    return snakeToCamel(raw) as T;
  }

  private async handleError(response: Response): Promise<never> {
    let body: unknown;
    let message = `HTTP ${response.status}`;
    try {
      body = await response.json();
      if (typeof body === "object" && body !== null) {
        if ("detail" in body) {
          // Codex P1 on PR #11315: ``body.detail`` is not always a
          // string. The server can return ``{"detail": {...}}`` for
          // structured validation errors, in which case casting to
          // ``string`` and then calling ``redactString`` below would
          // throw ``TypeError`` (.replace undefined on non-strings)
          // and replace the ``AvalaError`` subclass that callers
          // expect with a runtime crash. Only adopt the detail when
          // it actually IS a string; otherwise leave the default
          // ``HTTP <status>`` message and let callers inspect the
          // raw ``body``.
          const rawDetail = (body as { detail: unknown }).detail;
          if (typeof rawDetail === "string") {
            message = rawDetail;
          }
        } else {
          // Django returns field-level validation errors as { field: ["error", ...] }
          const entries = Object.entries(body as Record<string, unknown>);
          const fieldErrors: string[] = [];
          for (const [field, errors] of entries) {
            if (Array.isArray(errors)) {
              fieldErrors.push(`${field}: ${errors.join(", ")}`);
            }
          }
          if (fieldErrors.length > 0) {
            message = fieldErrors.join("; ");
          }
        }
      }
    } catch {
      // ignore JSON parse errors
    }

    // Pentest finding sdks/s3-4 (MED, CWE-200/209): the server commonly
    // echoes parts of the request payload in 4xx/5xx ``detail`` strings
    // (validation errors quote the offending field value). Without
    // redaction, secrets in the request body flow directly into caller
    // logs / Sentry / stdout via the thrown error's message and body.
    message = redactString(message);
    body = redact(body);

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
