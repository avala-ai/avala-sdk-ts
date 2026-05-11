import { describe, expect, it } from "vitest";
import { redact, redactString } from "../src/redaction.js";

describe("redactString", () => {
  it("passes through safe strings", () => {
    expect(redactString("Validation failed for field 'name'")).toBe("Validation failed for field 'name'");
  });

  it("redacts JWT tokens", () => {
    const leaky =
      "Invalid JWT: eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMSJ9.signature_here_aaa";
    const out = redactString(leaky);
    expect(out).not.toContain("eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(out).toContain("[redacted]");
  });

  it("redacts AWS access keys", () => {
    const leaky = "Provided key 'AKIAIOSFODNN7EXAMPLE' is not valid";
    const out = redactString(leaky);
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(out).toContain("[redacted]");
  });

  it("redacts prefix-keyed secrets", () => {
    // Synthetic ``secret_*`` shape — picked so GitHub's secret scanner
    // doesn't flag this test fixture as a real provider key.
    const leaky = "Got secret_NotARealKeyJustATestValueXYZ123456 rejected";
    const out = redactString(leaky);
    expect(out).not.toContain("NotARealKeyJustATestValueXYZ123456");
    expect(out).toContain("[redacted]");
  });

  it("redacts the Avala 40-hex API key shape", () => {
    const leaky = "Auth failed for key 0123456789abcdef0123456789abcdef01234567";
    const out = redactString(leaky);
    expect(out).not.toContain("0123456789abcdef0123456789abcdef01234567");
  });

  it("redacts Bearer headers (case-insensitive)", () => {
    const leaky = "Server got Authorization: Bearer abc123tokendata";
    const out = redactString(leaky);
    expect(out).not.toContain("abc123tokendata");
  });

  it("redacts X-Avala-Api-Key echoes", () => {
    const leaky = "X-Avala-Api-Key: my-secret-value rejected by middleware";
    const out = redactString(leaky);
    expect(out).not.toContain("my-secret-value");
  });

  it("redacts AWS ARNs", () => {
    const leaky =
      "User arn:aws:iam::123456789012:user/customer-bridge lacks permission";
    const out = redactString(leaky);
    expect(out).not.toContain("arn:aws:iam::123456789012:user/customer-bridge");
    expect(out).toContain("[redacted]");
  });

  it("redacts AWS secret access key field echoes (snake_case)", () => {
    // Reviewer P1 follow-up on PR #11315: AWS *secret* access keys are
    // 40 chars of base64-ish — too generic to match standalone. Context-
    // aware redaction kicks in next to a known field name. Synthetic
    // value picked so the test fixture isn't flagged as a real key.
    const leaky = "Got aws_secret_access_key=NotARealKeyThisIsJustATestValueXYZ123 rejected";
    const out = redactString(leaky);
    expect(out).not.toContain("NotARealKeyThisIsJustATestValueXYZ123");
    expect(out).toContain("[redacted]");
  });

  it("redacts AWS secret access key field echoes (camelCase JSON)", () => {
    const leaky = 'config.secretAccessKey: "NotARealKeyThisIsJustATestValueXYZ123"';
    const out = redactString(leaky);
    expect(out).not.toContain("NotARealKeyThisIsJustATestValueXYZ123");
  });

  it("redacts AWS_SECRET_ACCESS_KEY env-style echoes", () => {
    const leaky = "AWS_SECRET_ACCESS_KEY=NotARealKeyThisIsJustATestValueXYZ123";
    const out = redactString(leaky);
    expect(out).not.toContain("NotARealKeyThisIsJustATestValueXYZ123");
  });
});

describe("HttpTransport.handleError defends against structured detail", () => {
  it("does not throw when body.detail is an object instead of a string", async () => {
    // Codex P1 on PR #11315: a structured ``detail`` payload (some DRF
    // serializers return ``{"detail": {"field": ["error"]}}``) was
    // previously cast to ``string`` and then ``redactString`` was
    // called on it, throwing TypeError. Verify the type guard kicks in
    // and the SDK still raises a proper ``AvalaError`` subclass.
    const { HttpTransport } = await import("../src/http.js");
    const { ValidationError } = await import("../src/errors.js");

    const transport = new HttpTransport({ apiKey: "x", baseUrl: "https://api.example", timeout: 1000 });
    const response = new Response(
      JSON.stringify({ detail: { field: ["error"] } }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );

    await expect(
      (transport as unknown as { handleError: (r: Response) => Promise<never> }).handleError(response),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("redact (recursive)", () => {
  it("recurses into objects", () => {
    const body = {
      detail: "Bad token: AKIAIOSFODNN7EXAMPLE",
      code: "validation_failed",
      field: "credentials",
    };
    const out = redact(body) as Record<string, string>;
    expect(out.detail).not.toContain("AKIAIOSFODNN7EXAMPLE");
    // Non-secret fields untouched.
    expect(out.code).toBe("validation_failed");
    expect(out.field).toBe("credentials");
  });

  it("recurses into arrays", () => {
    const body = ["fine", "Bearer leaky_token", { detail: "AKIAIOSFODNN7EXAMPLE bad" }];
    const out = redact(body) as Array<string | Record<string, string>>;
    expect(out[0]).toBe("fine");
    expect(out[1]).not.toContain("leaky_token");
    expect((out[2] as Record<string, string>).detail).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("passes non-string non-container values through", () => {
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
  });

  it("handles empty containers", () => {
    expect(redact({})).toEqual({});
    expect(redact([])).toEqual([]);
  });
});

describe("redact (key-aware force redaction)", () => {
  // Reviewer P1 (round 2) on PR #11315: structured bodies like
  // {"aws_secret_access_key": "<40-char value>"} lost key context during
  // recursive redaction. The standalone 40-char base64-ish value is
  // intentionally too generic for the regex set, so the raw secret
  // stayed in the error body. Force-redact any scalar whose object key
  // matches a known sensitive name.

  it("force-redacts AWS secret access key in structured body", () => {
    const body = { aws_secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };
    const out = redact(body) as Record<string, string>;
    expect(out.aws_secret_access_key).toBe("[redacted]");
  });

  it("force-redacts camelCase secretAccessKey", () => {
    const body = { secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };
    const out = redact(body) as Record<string, string>;
    expect(out.secretAccessKey).toBe("[redacted]");
  });

  it("force-redacts kebab-case AWS-Secret-Access-Key", () => {
    const body: Record<string, string> = { "AWS-Secret-Access-Key": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };
    const out = redact(body) as Record<string, string>;
    expect(out["AWS-Secret-Access-Key"]).toBe("[redacted]");
  });

  it.each([
    "apiKey",
    "api_key",
    "Authorization",
    "authorization",
    "password",
    "Password",
    "accessToken",
    "refresh_token",
    "client_secret",
    "private_key",
  ])("force-redacts sensitive key name '%s'", (key) => {
    const body: Record<string, string> = { [key]: "any-secret-value-regardless-of-shape" };
    const out = redact(body) as Record<string, string>;
    expect(out[key]).toBe("[redacted]");
  });

  it("recursively force-redacts under a sensitive parent key", () => {
    const body = {
      credentials: {
        secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        id: "AKIAIOSFODNN7EXAMPLE",
      },
    };
    const out = redact(body) as Record<string, Record<string, string>>;
    expect(out.credentials.secret).toBe("[redacted]");
    expect(out.credentials.id).toBe("[redacted]");
  });

  it("leaves non-sensitive keys with safe values untouched", () => {
    const body = { region: "us-east-1", bucket: "customer-uploads" };
    const out = redact(body) as Record<string, string>;
    expect(out).toEqual({ region: "us-east-1", bucket: "customer-uploads" });
  });

  it("force-redacts numeric secrets under sensitive keys", () => {
    // Codex P2 follow-up on PR #11315: numeric OTPs ({"token": 123456})
    // and short-numeric passwords ARE secrets. Previous "pass-through
    // for non-string scalars" rationale was wrong — JSON parsers
    // collapse numeric-string secrets to numbers, and OTPs are
    // inherently numeric.
    const body = { token: 123456 as unknown, password: 1234 as unknown, client_secret: false as unknown };
    const out = redact(body) as Record<string, unknown>;
    expect(out.token).toBe("[redacted]");
    expect(out.password).toBe("[redacted]");
    expect(out.client_secret).toBe("[redacted]");
  });

  it("passes null/undefined under sensitive keys through", () => {
    // null/undefined cannot encode a secret and signal "not set" to
    // the caller. Distinguishing this from an actively-redacted value
    // matters for debugging.
    const body = { secret: null as unknown, password: undefined as unknown };
    const out = redact(body) as Record<string, unknown>;
    expect(out.secret).toBe(null);
    expect(out.password).toBe(undefined);
  });
});

describe("Codex follow-ups (PR #11449)", () => {
  it("redacts AWS STS session token under aws_session_token snake_case key", () => {
    // Codex P1: ``aws_session_token`` normalises to ``awssessiontoken``,
    // not ``sessiontoken``. The pre-fix sensitive-key set missed it.
    const body = { detail: { aws_session_token: "FwoGZXIvYXdzECoaDExlYWtTZWNyZXRWYWx1ZQ==" } };
    const out = redact(body) as Record<string, Record<string, unknown>>;
    expect(out.detail.aws_session_token).toBe("[redacted]");
  });

  it("redacts AWS STS session token by value-shape regex when not under the key", () => {
    const out = redactString("Invalid session token: FwoGZXIvYXdzECoaDExlYWtTZWNyZXRWYWx1ZQ==");
    expect(out).not.toContain("FwoGZXIvYXdzECoaDExlYWtTZWNyZXRWYWx1ZQ");
    expect(out).toContain("[redacted]");
  });

  it("redacts Google OAuth refresh tokens (1// prefix)", () => {
    // Codex P1: ``1//...`` shape was not in the regex set.
    const out = redactString("Refresh failed: 1//04hPzLOLXIQEOCgYIARAAGAQSNwF-L9Irbadtoken_x9ZmVx");
    expect(out).not.toContain("1//04hPzLOLXIQEOCgYIARAAGAQSNwF");
    expect(out).toContain("[redacted]");
  });

  it("redacts PEM private key blocks in body strings", () => {
    // Codex P1: PEM blocks from echoed GCP service-account JSON.
    const leaky =
      "Invalid private_key:\n" +
      "-----BEGIN RSA PRIVATE KEY-----\n" +
      "MIIEowIBAAKCAQEA+SECRETKEYBYTES+\n" +
      "morebase64lines==\n" +
      "-----END RSA PRIVATE KEY-----";
    const out = redactString(leaky);
    expect(out).not.toContain("SECRETKEYBYTES");
    expect(out).not.toContain("morebase64lines");
    expect(out).toContain("[redacted]");
  });

  it("redacts private_key_id field value embedded in JSON strings", () => {
    const out = redactString(
      '{"type":"service_account","private_key_id":"abc123def456abc123def456abc123def456abc1"}',
    );
    expect(out).not.toContain("abc123def456abc123def456abc123def456abc1");
    expect(out).toContain("[redacted]");
    // Non-sensitive type field stays.
    expect(out).toContain("service_account");
  });

  it("force-redacts private_key_id when surfaced as a structured key", () => {
    const body = { private_key_id: "any-shape-token-Z9" };
    const out = redact(body) as Record<string, unknown>;
    expect(out.private_key_id).toBe("[redacted]");
  });
});
