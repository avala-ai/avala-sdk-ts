import { describe, expect, it } from "vitest";

import { safeStringify, sanitizeForOutput } from "../src/redact.js";

describe("sanitizeForOutput (AVL-MCP-02)", () => {
  it("redacts deviceToken (camelCase) on a single device", () => {
    const device = { uid: "dev_1", name: "cam-1", deviceToken: "device_token_live_abcdefghijklmnop" };
    const out = sanitizeForOutput(device) as Record<string, unknown>;
    expect(out.deviceToken).toBe("[redacted]");
    expect(out.uid).toBe("dev_1");
    expect(out.name).toBe("cam-1");
  });

  it("redacts device_token (snake_case) too", () => {
    const out = sanitizeForOutput({ device_token: "device_token_live_abcdefghijklmnop" }) as Record<string, unknown>;
    expect(out.device_token).toBe("[redacted]");
  });

  it("redacts deviceToken inside a paginated list result", () => {
    const page = {
      results: [
        { uid: "dev_1", deviceToken: "device_token_live_aaaaaaaaaaaaaaaa" },
        { uid: "dev_2", deviceToken: "device_token_live_bbbbbbbbbbbbbbbb" },
      ],
      cursor: "next",
    };
    const text = safeStringify(page);
    expect(text).not.toContain("device_token_live_aaaaaaaaaaaaaaaa");
    expect(text).not.toContain("device_token_live_bbbbbbbbbbbbbbbb");
    expect(text).toContain("[redacted]");
    // Non-sensitive structure survives.
    expect(text).toContain("dev_1");
    expect(text).toContain('"cursor": "next"');
  });

  it("preserves null/undefined and non-sensitive scalars", () => {
    const out = sanitizeForOutput({ deviceToken: null, status: "online", count: 3 }) as Record<string, unknown>;
    expect(out.deviceToken).toBe(null);
    expect(out.status).toBe("online");
    expect(out.count).toBe(3);
  });

  it("redacts AWS STS session/access keys embedded in a config blob", () => {
    // Redaction is by KEY NAME, so the values are clearly-fake placeholders
    // (not real-key shapes) to keep the secret scanner happy. aws_session_token
    // normalises to 'awssessiontoken', not 'sessiontoken', so it is listed
    // explicitly in the sensitive set.
    const device = {
      uid: "dev_1",
      metadata: {
        aws_access_key_id: "FAKE-not-a-real-access-key-id",
        aws_secret_access_key: "FAKE-not-a-real-secret-value",
        aws_session_token: "FAKE-not-a-real-session-token",
      },
    };
    const text = safeStringify(device);
    expect(text).not.toContain("FAKE-not-a-real-access-key-id");
    expect(text).not.toContain("FAKE-not-a-real-secret-value");
    expect(text).not.toContain("FAKE-not-a-real-session-token");
    expect(text).toContain("[redacted]");
    expect(text).toContain("dev_1");
  });
});
