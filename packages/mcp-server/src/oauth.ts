import { createHash } from "node:crypto";
import {
  createRemoteJWKSet,
  customFetch,
  errors as joseErrors,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";
import { validateAccessToken } from "@avala-ai/sdk";

/** RFC 9728 metadata location for the protected `/mcp` resource. */
export const PROTECTED_RESOURCE_METADATA_PATH =
  "/.well-known/oauth-protected-resource/mcp";

const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const SCOPE_TOKEN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;
const MAX_SUBJECT_TOKEN_BYTES = 16 * 1024;
const MAX_EXCHANGE_BODY_BYTES = 64 * 1024;
const MAX_CACHE_ENTRIES = 1_000;
const DEFAULT_MAX_IN_FLIGHT_EXCHANGES = 128;
const CLOCK_TOLERANCE_SECONDS = 30;
const MAX_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60;
const OAUTH_ERROR_CODE = /^[A-Za-z_]{1,64}$/;

export interface HostedOAuthConfig {
  /** Exact protected-resource identifier and JWT audience, e.g. https://mcp.avala.ai/mcp. */
  resource: string;
  /** Auth0 issuer. It is canonicalized to an origin with a trailing slash. */
  authorizationServer: string;
  /** Audience of the downstream Avala Django API. */
  apiAudience: string;
  /** Confidential Auth0 client used only for RFC 8693 token exchange. */
  clientId: string;
  clientSecret: string;
  /** Scopes the hosted MCP resource is prepared to request downstream. */
  scopesSupported: string[];
}

interface ValidatedHostedOAuthConfig extends HostedOAuthConfig {
  jwksUrl: URL;
  tokenUrl: URL;
}

export interface OAuthExchangeResult {
  accessToken: string;
  subject: string;
  /** Original MCP subject-token iat, preserved across the downstream exchange. */
  subjectIssuedAt: number;
  scopes: readonly string[];
  expiresAt: number;
}

export interface OAuthTokenBroker {
  exchange(subjectToken: string): Promise<OAuthExchangeResult>;
}

export type OAuthErrorKind =
  "invalid_token" | "insufficient_scope" | "temporarily_unavailable";

/** Deliberately detail-free error safe to translate to an MCP HTTP response. */
export class HostedOAuthError extends Error {
  readonly kind: OAuthErrorKind;

  constructor(kind: OAuthErrorKind) {
    super(kind);
    this.name = "HostedOAuthError";
    this.kind = kind;
  }
}

interface BrokerDependencies {
  /** Local resolver in tests; production defaults to the issuer's remote JWKS. */
  jwks?: JWTVerifyGetKey;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  /** Bounded test override; production uses three seconds. */
  timeoutMs?: number;
  /** Bounded test override; production admits 128 unique exchanges at once. */
  maxInFlightExchanges?: number;
}

interface VerifiedSubject {
  subject: string;
  issuedAt: number;
  expiresAt: number;
  scopes: string[];
}

interface CachedExchange extends OAuthExchangeResult {}

function canonicalHttpsUrl(
  value: string,
  field: string,
  options: { rootOnly?: boolean } = {},
): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field} must be an absolute HTTPS URL.`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    (options.rootOnly && parsed.pathname !== "/")
  ) {
    throw new Error(
      `${field} must be an absolute HTTPS URL without credentials, query, or fragment.`,
    );
  }
  return parsed;
}

function validateScopeList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) {
    throw new Error(`${field} must contain 1-256 OAuth scope tokens.`);
  }
  const scopes: string[] = [];
  for (const scope of value) {
    if (
      typeof scope !== "string" ||
      scope.length > 128 ||
      !SCOPE_TOKEN.test(scope)
    ) {
      throw new Error(`${field} contains an invalid OAuth scope token.`);
    }
    scopes.push(scope);
  }
  if (
    new Set(scopes).size !== scopes.length ||
    scopes.join(" ").length > 4_096
  ) {
    throw new Error(
      `${field} must contain unique OAuth scope tokens totaling at most 4 KiB.`,
    );
  }
  return scopes;
}

/** Validate and normalize process configuration before the listener becomes healthy. */
export function validateHostedOAuthConfig(
  config: HostedOAuthConfig,
): ValidatedHostedOAuthConfig {
  const resource = canonicalHttpsUrl(config.resource, "resource");
  if (resource.pathname !== "/mcp" || resource.toString() !== config.resource) {
    throw new Error(
      "resource must be the canonical HTTPS URL of the /mcp endpoint.",
    );
  }

  const issuerInput = canonicalHttpsUrl(
    config.authorizationServer,
    "authorizationServer",
    { rootOnly: true },
  );
  const authorizationServer = `${issuerInput.origin}/`;
  const apiAudience = canonicalHttpsUrl(config.apiAudience, "apiAudience");
  if (apiAudience.toString() !== config.apiAudience) {
    throw new Error("apiAudience must be a canonical HTTPS URL.");
  }

  if (!/^[A-Za-z0-9_-]{8,256}$/.test(config.clientId)) {
    throw new Error("clientId must contain 8-256 URL-safe ASCII characters.");
  }
  if (!/^[\x21-\x7E]{16,1024}$/.test(config.clientSecret)) {
    throw new Error(
      "clientSecret must contain 16-1024 printable non-space ASCII characters.",
    );
  }

  return {
    resource: config.resource,
    authorizationServer,
    apiAudience: config.apiAudience,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scopesSupported: validateScopeList(
      config.scopesSupported,
      "scopesSupported",
    ),
    jwksUrl: new URL(".well-known/jwks.json", authorizationServer),
    tokenUrl: new URL("oauth/token", authorizationServer),
  };
}

export function protectedResourceMetadata(
  config: HostedOAuthConfig,
): Record<string, unknown> {
  const validated = validateHostedOAuthConfig(config);
  return {
    resource: validated.resource,
    authorization_servers: [validated.authorizationServer],
    bearer_methods_supported: ["header"],
    scopes_supported: validated.scopesSupported,
    resource_name: "Avala Physical AI Data Platform MCP",
  };
}

export function protectedResourceMetadataUrl(resource: string): string {
  const parsed = canonicalHttpsUrl(resource, "resource");
  return new URL(PROTECTED_RESOURCE_METADATA_PATH, parsed.origin).toString();
}

export function bearerChallenge(
  resource: string,
  options: {
    error?: Extract<OAuthErrorKind, "invalid_token" | "insufficient_scope">;
    scopes?: readonly string[];
  } = {},
): string {
  const parameters = [
    `resource_metadata="${protectedResourceMetadataUrl(resource)}"`,
  ];
  if (options.error !== undefined) parameters.push(`error="${options.error}"`);
  if (options.scopes !== undefined) {
    const scopes = validateScopeList(options.scopes, "challenge scopes");
    parameters.push(`scope="${scopes.join(" ")}"`);
  }
  return `Bearer ${parameters.join(", ")}`;
}

function parseGrantedScopes(value: unknown, field: string): Set<string> {
  if (typeof value !== "string" || value === "") {
    throw new HostedOAuthError("invalid_token");
  }
  const scopes = value.split(" ");
  if (
    scopes.join(" ") !== value ||
    scopes.some((scope) => scope.length > 128 || !SCOPE_TOKEN.test(scope)) ||
    new Set(scopes).size !== scopes.length
  ) {
    throw new HostedOAuthError("invalid_token");
  }
  return new Set(scopes);
}

function parsePermissions(value: unknown): Set<string> {
  if (
    !Array.isArray(value) ||
    value.some(
      (permission) =>
        typeof permission !== "string" ||
        permission.length > 128 ||
        !SCOPE_TOKEN.test(permission),
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new HostedOAuthError("invalid_token");
  }
  return new Set(value as string[]);
}

function classifyVerificationFailure(error: unknown): HostedOAuthError {
  if (error instanceof HostedOAuthError) return error;
  if (
    error instanceof joseErrors.JWKSTimeout ||
    error instanceof joseErrors.JWKSInvalid
  ) {
    return new HostedOAuthError("temporarily_unavailable");
  }
  if (error instanceof joseErrors.JWKSMultipleMatchingKeys) {
    return new HostedOAuthError("temporarily_unavailable");
  }
  if (error instanceof joseErrors.JOSEError) {
    // Generic JOSE errors from remote JWKS loading represent an unavailable
    // or malformed issuer endpoint. Token/claim/signature/JWK-selection
    // errors are caller authentication failures.
    return new HostedOAuthError(
      error.code === "ERR_JOSE_GENERIC"
        ? "temporarily_unavailable"
        : "invalid_token",
    );
  }
  // Remote fetch failures surface as platform TypeErrors rather than a JOSE
  // subclass. They are an identity-provider outage, not an invalid caller.
  return new HostedOAuthError("temporarily_unavailable");
}

async function readBoundedResponse(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < 0 ||
      parsed > MAX_EXCHANGE_BODY_BYTES
    ) {
      throw new HostedOAuthError("temporarily_unavailable");
    }
  }
  if (response.body === null) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_EXCHANGE_BODY_BYTES) {
      await reader.cancel();
      throw new HostedOAuthError("temporarily_unavailable");
    }
    body += decoder.decode(value, { stream: true });
  }
  return body + decoder.decode();
}

function classifyTokenEndpointFailure(
  status: number,
  responseBody: string,
): HostedOAuthError {
  let errorCode: string | undefined;
  try {
    const decoded: unknown = JSON.parse(responseBody);
    if (
      decoded !== null &&
      typeof decoded === "object" &&
      !Array.isArray(decoded)
    ) {
      const candidate = (decoded as Record<string, unknown>).error;
      if (typeof candidate === "string" && OAUTH_ERROR_CODE.test(candidate))
        errorCode = candidate;
    }
  } catch {
    // The bounded response was not an OAuth JSON error. Classify it as an
    // upstream/configuration failure without reflecting its contents.
  }

  // Never log the response body or error_description: providers can include
  // token, tenant, and client details there. Status + a constrained OAuth
  // error code are sufficient for operations without leaking credentials.
  console.error("avala-mcp-oauth: token exchange rejected", {
    status,
    error: errorCode ?? "unrecognized_response",
  });

  if (errorCode === "invalid_grant")
    return new HostedOAuthError("invalid_token");
  if (errorCode === "insufficient_scope")
    return new HostedOAuthError("insufficient_scope");
  return new HostedOAuthError("temporarily_unavailable");
}

/**
 * Verify a token issued for the MCP resource, then exchange it for a scoped
 * Avala API token. Subject tokens are never forwarded to Django.
 */
export class Auth0OnBehalfOfBroker implements OAuthTokenBroker {
  private readonly config: ValidatedHostedOAuthConfig;
  private readonly getKey: JWTVerifyGetKey;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly maxInFlightExchanges: number;
  private readonly cache = new Map<string, CachedExchange>();
  private readonly inFlight = new Map<string, Promise<OAuthExchangeResult>>();

  constructor(
    config: HostedOAuthConfig,
    dependencies: BrokerDependencies = {},
  ) {
    this.config = validateHostedOAuthConfig(config);
    this.fetchImpl = dependencies.fetch ?? globalThis.fetch;
    this.now = dependencies.now ?? Date.now;
    this.timeoutMs = dependencies.timeoutMs ?? 3_000;
    if (
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs <= 0 ||
      this.timeoutMs > 30_000
    ) {
      throw new Error(
        "OAuth broker timeout must be an integer from 1 to 30000 milliseconds.",
      );
    }
    this.maxInFlightExchanges =
      dependencies.maxInFlightExchanges ?? DEFAULT_MAX_IN_FLIGHT_EXCHANGES;
    if (
      !Number.isSafeInteger(this.maxInFlightExchanges) ||
      this.maxInFlightExchanges <= 0 ||
      this.maxInFlightExchanges > 1_000
    ) {
      throw new Error(
        "OAuth broker concurrency must be an integer from 1 to 1000 exchanges.",
      );
    }
    this.getKey =
      dependencies.jwks ??
      createRemoteJWKSet(this.config.jwksUrl, {
        timeoutDuration: this.timeoutMs,
        cooldownDuration: 30_000,
        cacheMaxAge: 5 * 60_000,
        ...(dependencies.fetch
          ? {
              [customFetch]: (url: string, options) =>
                dependencies.fetch!(url, options),
            }
          : {}),
      });
  }

  async exchange(subjectToken: string): Promise<OAuthExchangeResult> {
    if (
      typeof subjectToken !== "string" ||
      subjectToken.length > MAX_SUBJECT_TOKEN_BYTES ||
      !JWT_SHAPE.test(subjectToken)
    ) {
      throw new HostedOAuthError("invalid_token");
    }

    const cacheKey = createHash("sha256")
      .update(subjectToken)
      .digest("base64url");
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      if (cached.expiresAt > this.now()) {
        // Refresh insertion order so the bounded Map behaves as an LRU.
        this.cache.delete(cacheKey);
        this.cache.set(cacheKey, cached);
        return cached;
      }
      this.cache.delete(cacheKey);
    }

    const existing = this.inFlight.get(cacheKey);
    if (existing !== undefined) return existing;
    if (this.inFlight.size >= this.maxInFlightExchanges) {
      throw new HostedOAuthError("temporarily_unavailable");
    }

    const pending = this.exchangeUncached(subjectToken)
      .then((result) => {
        if (result.expiresAt > this.now()) {
          while (this.cache.size >= MAX_CACHE_ENTRIES) {
            const oldest = this.cache.keys().next().value as string | undefined;
            if (oldest === undefined) break;
            this.cache.delete(oldest);
          }
          this.cache.set(cacheKey, result);
        }
        return result;
      })
      .finally(() => this.inFlight.delete(cacheKey));
    this.inFlight.set(cacheKey, pending);
    return pending;
  }

  private async verifySubjectToken(
    subjectToken: string,
  ): Promise<VerifiedSubject> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(subjectToken, this.getKey, {
        algorithms: ["RS256"],
        issuer: this.config.authorizationServer,
        audience: this.config.resource,
        requiredClaims: ["sub", "exp", "iat", "scope", "permissions"],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        currentDate: new Date(this.now()),
      }));
    } catch (error) {
      throw classifyVerificationFailure(error);
    }

    if (
      typeof payload.sub !== "string" ||
      payload.sub === "" ||
      payload.sub !== payload.sub.trim() ||
      payload.sub.length > 512 ||
      typeof payload.iat !== "number" ||
      !Number.isSafeInteger(payload.iat) ||
      payload.iat <= 0 ||
      payload.iat > Math.floor(this.now() / 1_000) + CLOCK_TOLERANCE_SECONDS ||
      typeof payload.exp !== "number" ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp * 1_000 <= this.now() + CLOCK_TOLERANCE_SECONDS * 1_000
    ) {
      throw new HostedOAuthError("invalid_token");
    }
    // A cnf claim sender-constrains the token to DPoP or an mTLS key. The
    // hosted MCP transport does not yet verify either proof, so accepting it
    // as a bearer token would silently strip the issuer's security property.
    if (payload.cnf !== undefined) throw new HostedOAuthError("invalid_token");

    const grantedScopes = parseGrantedScopes(payload.scope, "scope");
    const permissions = parsePermissions(payload.permissions);
    const effectiveScopes = this.config.scopesSupported.filter(
      (scope) => grantedScopes.has(scope) && permissions.has(scope),
    );
    if (effectiveScopes.length === 0) {
      throw new HostedOAuthError("insufficient_scope");
    }

    return {
      subject: payload.sub,
      issuedAt: payload.iat,
      expiresAt: payload.exp * 1_000,
      scopes: effectiveScopes,
    };
  }

  private async exchangeUncached(
    subjectToken: string,
  ): Promise<OAuthExchangeResult> {
    const verified = await this.verifySubjectToken(subjectToken);
    const body = new URLSearchParams({
      grant_type: TOKEN_EXCHANGE_GRANT,
      subject_token: subjectToken,
      subject_token_type: ACCESS_TOKEN_TYPE,
      requested_token_type: ACCESS_TOKEN_TYPE,
      audience: this.config.apiAudience,
      scope: verified.scopes.join(" "),
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    let responseBody: string;
    try {
      response = await this.fetchImpl(this.config.tokenUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        redirect: "manual",
        signal: controller.signal,
      });
      // Keep the same deadline active while consuming the response. Clearing
      // it as soon as headers arrive would let a stalled identity-provider
      // body hold an MCP request open indefinitely.
      responseBody = await readBoundedResponse(response);
    } catch (error) {
      if (error instanceof HostedOAuthError) throw error;
      throw new HostedOAuthError("temporarily_unavailable");
    } finally {
      clearTimeout(timeout);
    }

    if (response.status !== 200) {
      throw classifyTokenEndpointFailure(response.status, responseBody);
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(responseBody);
    } catch {
      throw new HostedOAuthError("temporarily_unavailable");
    }
    if (
      decoded === null ||
      typeof decoded !== "object" ||
      Array.isArray(decoded)
    ) {
      throw new HostedOAuthError("temporarily_unavailable");
    }
    const tokenResponse = decoded as Record<string, unknown>;
    try {
      validateAccessToken(tokenResponse.access_token);
    } catch {
      throw new HostedOAuthError("temporarily_unavailable");
    }
    if (
      typeof tokenResponse.token_type !== "string" ||
      tokenResponse.token_type.toLowerCase() !== "bearer" ||
      tokenResponse.issued_token_type !== ACCESS_TOKEN_TYPE ||
      typeof tokenResponse.expires_in !== "number" ||
      !Number.isSafeInteger(tokenResponse.expires_in) ||
      tokenResponse.expires_in <= 0 ||
      tokenResponse.expires_in > MAX_EXPIRES_IN_SECONDS
    ) {
      throw new HostedOAuthError("temporarily_unavailable");
    }

    let returnedScopes = verified.scopes;
    if (tokenResponse.scope !== undefined) {
      let responseScopes: Set<string>;
      try {
        responseScopes = parseGrantedScopes(tokenResponse.scope, "scope");
      } catch {
        throw new HostedOAuthError("temporarily_unavailable");
      }
      if (
        [...responseScopes].some((scope) => !verified.scopes.includes(scope)) ||
        responseScopes.size === 0
      ) {
        throw new HostedOAuthError("temporarily_unavailable");
      }
      returnedScopes = verified.scopes.filter((scope) =>
        responseScopes.has(scope),
      );
    }

    const now = this.now();
    const expiresAt =
      Math.min(verified.expiresAt, now + tokenResponse.expires_in * 1_000) -
      CLOCK_TOLERANCE_SECONDS * 1_000;
    return {
      accessToken: tokenResponse.access_token,
      subject: verified.subject,
      subjectIssuedAt: verified.issuedAt,
      scopes: returnedScopes,
      expiresAt,
    };
  }
}
