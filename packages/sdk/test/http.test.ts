import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpTransport } from "../src/http.js";
import {
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  ServerError,
  AvalaError,
} from "../src/errors.js";

function makeTransport(overrides?: { apiKey?: string; baseUrl?: string; timeout?: number }): HttpTransport {
  return new HttpTransport({
    apiKey: overrides?.apiKey ?? "test-api-key",
    baseUrl: overrides?.baseUrl ?? "https://api.example.com",
    timeout: overrides?.timeout ?? 30000,
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

    it("rejects redirects to avoid leaking the API key", async () => {
      mockFetch({ ok: false, status: 302, json: () => Promise.resolve({}), headers: new Headers() });
      const http = makeTransport();
      await expect(http.request("GET", "/test/")).rejects.toThrow(/redirect/i);
    });
  });
});
