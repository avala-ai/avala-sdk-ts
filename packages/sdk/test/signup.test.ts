import { describe, it, expect, vi, afterEach } from "vitest";
import { signup } from "../src/signup.js";
import { ValidationError, RateLimitError } from "../src/errors.js";

const BASE_URL = "https://api.example.com";

const SIGNUP_RESPONSE = {
  user: {
    uid: "abc123",
    username: "dev@acme.com",
    email: "dev@acme.com",
    first_name: "Jane",
    last_name: "",
    in_waitlist: true,
  },
  api_key: "a1b2c3",
};

function mockFetch(response: { ok: boolean; status: number; json?: () => Promise<unknown>; headers?: Headers }) {
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

describe("signup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed SignupResponse on success", async () => {
    mockFetch({ ok: true, status: 201, json: () => Promise.resolve(SIGNUP_RESPONSE) });
    const result = await signup({ email: "dev@acme.com", password: "secret123", baseUrl: BASE_URL });

    expect(result.user.uid).toBe("abc123");
    expect(result.user.username).toBe("dev@acme.com");
    expect(result.user.email).toBe("dev@acme.com");
    expect(result.user.firstName).toBe("Jane");
    expect(result.user.inWaitlist).toBe(true);
    expect(result.apiKey).toBe("a1b2c3");
  });

  it("sends optional fields when provided", async () => {
    mockFetch({ ok: true, status: 201, json: () => Promise.resolve(SIGNUP_RESPONSE) });
    await signup({
      email: "dev@acme.com",
      password: "secret123",
      firstName: "Jane",
      lastName: "Doe",
      baseUrl: BASE_URL,
    });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]!.body as string);
    expect(body.first_name).toBe("Jane");
    expect(body.last_name).toBe("Doe");
  });

  it("does not send optional fields when omitted", async () => {
    mockFetch({ ok: true, status: 201, json: () => Promise.resolve(SIGNUP_RESPONSE) });
    await signup({ email: "dev@acme.com", password: "secret123", baseUrl: BASE_URL });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]!.body as string);
    expect(body).not.toHaveProperty("first_name");
    expect(body).not.toHaveProperty("last_name");
  });

  it("does not send X-Avala-Api-Key header", async () => {
    mockFetch({ ok: true, status: 201, json: () => Promise.resolve(SIGNUP_RESPONSE) });
    await signup({ email: "dev@acme.com", password: "secret123", baseUrl: BASE_URL });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const headers = fetchCall[1]!.headers as Record<string, string>;
    expect(headers).not.toHaveProperty("X-Avala-Api-Key");
  });

  it("throws ValidationError on 400", async () => {
    mockFetch({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ detail: "Email already registered." }),
    });

    await expect(signup({ email: "dev@acme.com", password: "secret123", baseUrl: BASE_URL })).rejects.toThrow(
      ValidationError
    );
  });

  it("throws RateLimitError on 429 with retryAfter", async () => {
    const headers = new Headers({ "Retry-After": "60" });
    mockFetch({
      ok: false,
      status: 429,
      json: () => Promise.resolve({ detail: "Too many requests." }),
      headers,
    });

    try {
      await signup({ email: "dev@acme.com", password: "secret123", baseUrl: BASE_URL });
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitError);
      expect((error as RateLimitError).retryAfter).toBe(60);
    }
  });
});
