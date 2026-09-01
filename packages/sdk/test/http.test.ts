import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpTransport, type HttpConfig } from "../src/http.js";
import {
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  ServerError,
  AvalaError,
} from "../src/errors.js";

type HttpOverrides = Partial<Omit<HttpConfig, "apiKey" | "accessToken">> & {
  apiKey?: string;
  accessToken?: string;
};

function makeTransport(overrides?: HttpOverrides): HttpTransport {
  const credential = overrides?.accessToken !== undefined
    ? { accessToken: overrides.accessToken }
    : { apiKey: overrides?.apiKey ?? "test-api-key" };
  return new HttpTransport({
    ...credential,
    baseUrl: overrides?.baseUrl ?? "https://api.example.com",
    timeout: overrides?.timeout ?? 30000,
    clientName: overrides?.clientName,
    internalClientSecret: overrides?.internalClientSecret,
    forwardedClientIp: overrides?.forwardedClientIp,
    mcpSubjectTokenIssuedAt: overrides?.mcpSubjectTokenIssuedAt,
  });
}

function mockFetch(response: Partial<Response> & { ok: boolean; status: number; json?: () => Promise<unknown>; headers?: Headers }) {
  const headers = response.headers ?? new Headers();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status,
      json: response.json ?? (() => Promise.resolve({})),
      headers,
    })
  );
}

describe("HttpTransport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("request headers", () => {
    it("sends X-Avala-Api-Key header", async () => {
      mockFetch({ ok: true, status: 200, json: () => Promise.resolve({ result: "ok" }) });
      const http = makeTransport({ apiKey: "my-secret-key" });
      await http.request("GET", "/test/");

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const options = fetchCall[1] as RequestInit;
      expect((options.headers as Record<string, string>)["X-Avala-Api-Key"]).toBe("my-secret-key");
      expect((options.headers as Record<string, string>)["Authorization"]).toBeUndefined();
    });

    it("sends an OAuth access token as Bearer without an API-key header", async () => {
      mockFetch({ ok: true, status: 200, json: () => Promise.resolve({ result: "ok" }) });
      const http = makeTransport({ accessToken: "header.payload.signature" });
      await http.request("GET", "/test/");

      const headers = (vi.mocked(fetch).mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer header.payload.signature");
      expect(headers["X-Avala-Api-Key"]).toBeUndefined();
    });

    it("sends bounded client provenance headers when configured", async () => {
      mockFetch({ ok: true, status: 200, json: () => Promise.resolve({ result: "ok" }) });
      const http = makeTransport({
        clientName: "list_datasets",
        internalClientSecret: "s".repeat(32),
        forwardedClientIp: "203.0.113.42",
      });
      await http.request("GET", "/test/");

      const headers = (vi.mocked(fetch).mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers["X-Avala-Client"]).toBe("list_datasets");
      expect(headers["X-Avala-Internal-Client"]).toBe("s".repeat(32));
      expect(headers["X-Avala-Forwarded-Client-IP"]).toBe("203.0.113.42");
    });

    it("forwards original subject issuance only for trusted hosted OAuth", async () => {
      mockFetch({ ok: true, status: 200, json: () => Promise.resolve({ result: "ok" }) });
      const http = makeTransport({
        accessToken: "downstream.api.token",
        internalClientSecret: "s".repeat(32),
        forwardedClientIp: "203.0.113.42",
        mcpSubjectTokenIssuedAt: 1_788_000_000,
      });
      await http.request("GET", "/test/");

      const headers = (vi.mocked(fetch).mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers["X-Avala-OAuth-Subject-Iat"]).toBe("1788000000");
    });

    it("omits provenance headers when they are not configured", async () => {
      mockFetch({ ok: true, status: 200, json: () => Promise.resolve({ result: "ok" }) });
      await makeTransport().request("GET", "/test/");

      const headers = (vi.mocked(fetch).mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers["X-Avala-Client"]).toBeUndefined();
      expect(headers["X-Avala-Internal-Client"]).toBeUndefined();
      expect(headers["X-Avala-Forwarded-Client-IP"]).toBeUndefined();
      expect(headers["X-Avala-OAuth-Subject-Iat"]).toBeUndefined();
    });

    it("sends Accept: application/json header", async () => {
      mockFetch({ ok: true, status: 200, json: () => Promise.resolve({}) });
      const http = makeTransport();
      await http.request("GET", "/test/");

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const options = fetchCall[1] as RequestInit;
      expect((options.headers as Record<string, string>)["Accept"]).toBe("application/json");
    });

    it("sends Content-Type for POST requests with JSON body", async () => {
      mockFetch({ ok: true, status: 200, json: () => Promise.resolve({}) });
      const http = makeTransport();
      await http.request("POST", "/test/", { json: { name: "test" } });

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const options = fetchCall[1] as RequestInit;
      expect((options.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
      expect(options.body).toBe(JSON.stringify({ name: "test" }));
    });

    it("does not send Content-Type for GET requests", async () => {
      mockFetch({ ok: true, status: 200, json: () => Promise.resolve({}) });
      const http = makeTransport();
      await http.request("GET", "/test/");

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const options = fetchCall[1] as RequestInit;
      expect((options.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    });

    it("sends one validated idempotency key for a mutation", async () => {
      mockFetch({ ok: true, status: 200, json: () => Promise.resolve({ uid: "result" }) });
      const http = makeTransport();

      await http.requestCreate(
        "/admin/workforce/batches/batch/priority/",
        { priority: "high" },
        { idempotencyKey: "550e8400-e29b-41d4-a716-446655440000" },
      );

      const headers = (vi.mocked(fetch).mock.calls[0]![1] as RequestInit)
        .headers as Record<string, string>;
      expect(headers["Idempotency-Key"]).toBe(
        "550e8400-e29b-41d4-a716-446655440000",
      );
    });

    it.each([
      "not-a-uuid",
      "550E8400-E29B-41D4-A716-446655440000",
      "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      "550e8400-e29b-41d4-7716-446655440000",
      "550e8400-e29b-41d4-a716-446655440000\r\nInjected: true",
    ])("rejects an invalid idempotency key %j before fetch", async (idempotencyKey) => {
      const http = makeTransport();

      await expect(
        http.requestCreate("/test/", {}, { idempotencyKey }),
      ).rejects.toThrow("canonical lowercase UUIDv4");
      expect(fetch).not.toHaveBeenCalled();
    });

    it("rejects an idempotency key on a read", async () => {
      const http = makeTransport();

      await expect(
        http.request("GET", "/test/", {
          idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
        }),
      ).rejects.toThrow("only for mutation requests");
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe("provenance configuration", () => {
    it("rejects missing or ambiguous caller credentials at runtime", () => {
      const connection = { baseUrl: "https://api.example.com", timeout: 30_000 };
      expect(() => new HttpTransport(connection as HttpConfig)).toThrowError("exactly one");
      for (const accessToken of ["header.payload.signature", "", null]) {
        expect(
          () =>
            new HttpTransport({
              ...connection,
              apiKey: "test-key",
              accessToken,
            } as unknown as HttpConfig),
        ).toThrowError("exactly one");
      }
      expect(
        () => new HttpTransport({ ...connection, accessToken: null } as unknown as HttpConfig),
      ).toThrowError("accessToken");
    });

    it.each(["with space", "line\r\nbreak", "", "é", "x".repeat(16 * 1024 + 1)])(
      "rejects a non-canonical OAuth access token",
      (accessToken) => {
        expect(() => makeTransport({ accessToken })).toThrowError(/accessToken|exactly one/);
      },
    );

    it.each(["List_Datasets", "mcp/list_datasets", "list-datasets", "a".repeat(65), "list_datasets\r\nInjected: true"])(
      "rejects an invalid clientName %j",
      (clientName) => {
        expect(() => makeTransport({ clientName })).toThrowError("clientName must match");
      },
    );

    it.each([
      "too-short",
      ` ${"s".repeat(32)}`,
      `${"s".repeat(32)} `,
      "é".repeat(32),
      "s".repeat(513),
      "secret\r\nInjected: true".padEnd(32, "s"),
    ])("rejects a non-canonical internal service secret", (internalClientSecret) => {
      expect(() => makeTransport({ internalClientSecret, forwardedClientIp: "203.0.113.42" })).toThrowError(
        "internalClientSecret must contain 32-512 URL-safe ASCII characters",
      );
    });

    it.each([
      "203.0.113",
      "203.0.113.999",
      "01.2.3.4",
      "203.0.113.1, 198.51.100.1",
      " 203.0.113.1",
      "fe80::1%eth0",
      "2001:db8:::1",
      "not-an-ip",
      "1".repeat(65),
    ])("rejects an invalid forwardedClientIp %j", (forwardedClientIp) => {
      expect(() => makeTransport({ internalClientSecret: "s".repeat(32), forwardedClientIp })).toThrowError(
        "forwardedClientIp must contain one valid IPv4 or IPv6 address",
      );
    });

    it.each(["203.0.113.42", "2001:db8::1", "::ffff:192.0.2.128"])(
      "accepts one IPv4 or IPv6 forwardedClientIp %j",
      (forwardedClientIp) => {
        expect(() =>
          makeTransport({ internalClientSecret: "s".repeat(32), forwardedClientIp }),
        ).not.toThrow();
      },
    );

    it("allows the legacy secret-only form during the sender-first rollout", () => {
      expect(() => makeTransport({ internalClientSecret: "s".repeat(32) })).not.toThrow();
    });

    it("requires the internal service secret whenever a forwarded client IP is configured", () => {
      expect(() => makeTransport({ forwardedClientIp: "203.0.113.42" })).toThrowError(
        "forwardedClientIp requires internalClientSecret",
      );
    });

    it("binds subject issuance to access-token mode and trusted MCP context", () => {
      const trusted = {
        internalClientSecret: "s".repeat(32),
        forwardedClientIp: "203.0.113.42",
        mcpSubjectTokenIssuedAt: 1_788_000_000,
      };
      expect(() => makeTransport({ apiKey: "api-key", ...trusted })).toThrowError(
        "mcpSubjectTokenIssuedAt requires accessToken",
      );
      expect(() =>
        makeTransport({ accessToken: "downstream.api.token", mcpSubjectTokenIssuedAt: 1_788_000_000 }),
      ).toThrowError("mcpSubjectTokenIssuedAt requires accessToken");
    });

    it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1788000000", null])(
      "rejects invalid subject issuance %j",
      (mcpSubjectTokenIssuedAt) => {
        expect(() =>
          makeTransport({
            accessToken: "downstream.api.token",
            internalClientSecret: "s".repeat(32),
            forwardedClientIp: "203.0.113.42",
            mcpSubjectTokenIssuedAt: mcpSubjectTokenIssuedAt as number,
          }),
        ).toThrowError("mcpSubjectTokenIssuedAt");
      },
    );
  });

  describe("request method", () => {
    it("makes GET requests to the correct URL", async () => {
      mockFetch({ ok: true, status: 200, json: () => Promise.resolve({ id: 1 }) });
      const http = makeTransport({ baseUrl: "https://api.example.com" });
      const result = await http.request<{ id: number }>("GET", "/items/");

      expect(fetch).toHaveBeenCalledTimes(1);
      const url = vi.mocked(fetch).mock.calls[0][0];
      expect(url).toBe("https://api.example.com/items/");
      expect(result).toEqual({ id: 1 });
    });

    it("makes POST requests with JSON body", async () => {
      mockFetch({ ok: true, status: 200, json: () => Promise.resolve({ id: 2, name: "new" }) });
      const http = makeTransport();
      const result = await http.request<{ id: number; name: string }>("POST", "/items/", {
        json: { name: "new" },
      });

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect((fetchCall[1] as RequestInit).method).toBe("POST");
      expect(result).toEqual({ id: 2, name: "new" });
    });

    it("returns undefined for 204 No Content", async () => {
      mockFetch({ ok: true, status: 204 });
      const http = makeTransport();
      const result = await http.request("DELETE", "/items/1/");
      expect(result).toBeUndefined();
    });

    it("appends query params to URL", async () => {
      mockFetch({ ok: true, status: 200, json: () => Promise.resolve({}) });
      const http = makeTransport({ baseUrl: "https://api.example.com" });
      await http.request("GET", "/items/", { params: { limit: "10", cursor: "abc" } });

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toContain("limit=10");
      expect(url).toContain("cursor=abc");
    });
  });

  describe("requestPage", () => {
    it("converts snake_case keys to camelCase", async () => {
      mockFetch({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            results: [{ uid: "abc", item_count: 42, data_type: "image", created_at: "2025-01-01" }],
            next: null,
            previous: null,
          }),
      });

      const http = makeTransport();
      const page = await http.requestPage<{ uid: string; itemCount: number; dataType: string; createdAt: string }>("/datasets/");

      expect(page.items[0].itemCount).toBe(42);
      expect(page.items[0].dataType).toBe("image");
      expect(page.items[0].createdAt).toBe("2025-01-01");
    });

    it("extracts cursor from next URL", async () => {
      mockFetch({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            results: [{ uid: "abc" }],
            next: "https://api.avala.ai/api/v1/datasets/?cursor=nextpage123",
            previous: "https://api.avala.ai/api/v1/datasets/?cursor=prevpage456",
          }),
      });

      const http = makeTransport();
      const page = await http.requestPage("/datasets/");

      expect(page.nextCursor).toBe("nextpage123");
      expect(page.previousCursor).toBe("prevpage456");
    });

    it("sets hasMore to true when next is present", async () => {
      mockFetch({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            results: [],
            next: "https://api.avala.ai/api/v1/datasets/?cursor=abc",
            previous: null,
          }),
      });

      const http = makeTransport();
      const page = await http.requestPage("/datasets/");
      expect(page.hasMore).toBe(true);
    });

    it("sets hasMore to false when next is null", async () => {
      mockFetch({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            results: [],
            next: null,
            previous: null,
          }),
      });

      const http = makeTransport();
      const page = await http.requestPage("/datasets/");
      expect(page.hasMore).toBe(false);
    });
  });

  describe("requestSingle", () => {
    it("converts snake_case keys to camelCase", async () => {
      mockFetch({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            uid: "xyz",
            display_name: "Test",
            item_count: 5,
            created_at: "2025-06-01",
          }),
      });

      const http = makeTransport();
      const result = await http.requestSingle<{ uid: string; displayName: string; itemCount: number; createdAt: string }>("/items/xyz/");

      expect(result.displayName).toBe("Test");
      expect(result.itemCount).toBe(5);
      expect(result.createdAt).toBe("2025-06-01");
    });

    it("forwards query params while converting the response", async () => {
      mockFetch({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status_count: { open: 5 } }),
      });

      const http = makeTransport({ baseUrl: "https://api.example.com" });
      const result = await http.requestSingle<{ statusCount: { open: number } }>("/metrics/", {
        sequence_uid: "seq-001",
      });

      expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("https://api.example.com/metrics/?sequence_uid=seq-001");
      expect(result).toEqual({ statusCount: { open: 5 } });
    });
  });

  describe("handleError", () => {
    it("throws AuthenticationError for 401", async () => {
      mockFetch({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ detail: "Invalid API key" }),
      });

      const http = makeTransport();
      try {
        await http.request("GET", "/test/");
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AuthenticationError);
        expect((e as AuthenticationError).message).toBe("Invalid API key");
        expect((e as AuthenticationError).statusCode).toBe(401);
      }
    });

    it("throws NotFoundError for 404", async () => {
      mockFetch({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ detail: "Not found." }),
      });

      const http = makeTransport();
      await expect(http.request("GET", "/missing/")).rejects.toThrow(NotFoundError);
    });

    it("throws RateLimitError for 429 with Retry-After header", async () => {
      const headers = new Headers({ "Retry-After": "60" });
      mockFetch({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ detail: "Too many requests" }),
        headers,
      });

      const http = makeTransport();
      try {
        await http.request("GET", "/test/");
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(RateLimitError);
        expect((e as RateLimitError).retryAfter).toBe(60);
        expect((e as RateLimitError).statusCode).toBe(429);
      }
    });

    it("throws ValidationError for 400", async () => {
      mockFetch({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ detail: "Bad request" }),
      });

      const http = makeTransport();
      await expect(http.request("POST", "/test/", { json: {} })).rejects.toThrow(ValidationError);
    });

    it("throws ValidationError for 422", async () => {
      mockFetch({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ detail: "Unprocessable entity" }),
      });

      const http = makeTransport();
      await expect(http.request("POST", "/test/", { json: {} })).rejects.toThrow(ValidationError);
    });

    it("throws ServerError for 500", async () => {
      mockFetch({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ detail: "Internal server error" }),
      });

      const http = makeTransport();
      await expect(http.request("GET", "/test/")).rejects.toThrow(ServerError);
    });

    it("throws ServerError for 503", async () => {
      mockFetch({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ detail: "Service unavailable" }),
      });

      const http = makeTransport();
      await expect(http.request("GET", "/test/")).rejects.toThrow(ServerError);
    });

    it("throws AvalaError for unknown status codes", async () => {
      mockFetch({
        ok: false,
        status: 418,
        json: () => Promise.resolve({ detail: "I'm a teapot" }),
      });

      const http = makeTransport();
      try {
        await http.request("GET", "/test/");
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AvalaError);
        expect((e as AvalaError).statusCode).toBe(418);
        // Should not be a more specific subclass
        expect(e).not.toBeInstanceOf(AuthenticationError);
        expect(e).not.toBeInstanceOf(NotFoundError);
        expect(e).not.toBeInstanceOf(ServerError);
      }
    });

    it("extracts field-level validation errors for 400 without detail", async () => {
      mockFetch({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ project: ["This field is required."], dataset: ["Invalid UID format."] }),
      });

      const http = makeTransport();
      try {
        await http.request("POST", "/exports/", { json: {} });
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        expect((e as ValidationError).message).toBe("project: This field is required.; dataset: Invalid UID format.");
        expect((e as ValidationError).body).toEqual({ project: ["This field is required."], dataset: ["Invalid UID format."] });
      }
    });

    it("handles non-JSON error responses gracefully", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 502,
          json: () => Promise.reject(new SyntaxError("Unexpected token")),
          headers: new Headers(),
        })
      );

      const http = makeTransport();
      try {
        await http.request("GET", "/test/");
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ServerError);
        expect((e as ServerError).message).toBe("HTTP 502");
      }
    });
  });

  describe("path validation (security)", () => {
    it("rejects path-traversal segments", async () => {
      const http = makeTransport();
      await expect(http.request("GET", "/datasets/../admin/")).rejects.toThrow(/traversal/);
      await expect(http.request("GET", "/datasets/foo/..")).rejects.toThrow(/traversal/);
      await expect(http.request("GET", "/datasets/./admin/")).rejects.toThrow(/traversal/);
    });

    it("rejects URL-encoded path-traversal segments", async () => {
      const http = makeTransport();
      await expect(http.request("GET", "/datasets/%2e%2e/admin/")).rejects.toThrow(/URL-encoded/);
      await expect(http.request("GET", "/datasets/%2E%2E/admin/")).rejects.toThrow(/URL-encoded/);
    });

    it("rejects mid-path '//' segments", async () => {
      const http = makeTransport();
      await expect(http.request("GET", "/datasets//admin/")).rejects.toThrow(/'\/\/'/);
    });

    it("rejects URL schemes embedded in the path portion", async () => {
      const http = makeTransport();
      await expect(http.request("GET", "/datasets/http://evil.example.com/")).rejects.toThrow(/URL scheme/);
    });

    it.each([
      ["API key", { apiKey: "test-api-key" }],
      ["OAuth token", { accessToken: "header.payload.signature" }],
    ] as const)("refuses redirects in %s mode before credentials can be replayed", async (_mode, credential) => {
      mockFetch({ ok: false, status: 302, json: () => Promise.resolve({}), headers: new Headers() });
      const http = makeTransport(credential);
      await expect(http.request("GET", "/test/")).rejects.toThrow(/redirect/i);
      expect((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).redirect).toBe("manual");
    });
  });
});
