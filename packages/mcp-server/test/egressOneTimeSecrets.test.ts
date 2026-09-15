/**
 * Opaque one-time credentials inside serialised JSON text
 * (AVALA-SEC-2026-0075, -0094, -0119, -0123, -0125).
 *
 * Five reports found the same gap from five directions: a hand-written tool
 * does `JSON.stringify(upstream)`, the egress boundary then sees a STRING, and
 * a 64-hex webhook secret or a deviceToken has no pattern the value scanner
 * knows. The key name was the only signal, and it was inside the string.
 *
 * Every payload here is the shape the shipped handlers emit, with the
 * credential replaced by a same-shape fake. Each case was verified to FAIL
 * against the pre-fix `scrubToolResult` before the boundary learned to parse
 * JSON text — a test that cannot fail is not coverage.
 */
import { describe, expect, it } from "vitest";
import { REDACTED_OUTPUT_VALUE } from "../src/redact.js";
import { scrubToolResult } from "../src/egress.js";

/** 64 hex chars, exactly what `secrets.token_hex(32)` produces server-side. */
const WEBHOOK_SECRET =
  "3f9c1b2a8d7e6f5049e8b7a6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6";
const AGENT_SECRET = "agt_9Qx7vL2mN4pR8sT1uW3yZ5aB6cD0eF2g";
const DEVICE_TOKEN = "dvt_kJ8mP2qR5tV7wX9yA1bC3dE5fG7hI9jK";

function textResult(value: unknown, pretty = true) {
  return {
    content: [
      {
        type: "text" as const,
        text: pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value),
      },
    ],
  };
}

function firstText(result: { content: { text: string }[] }): string {
  return result.content[0]!.text;
}

describe("one-time secrets in JSON text content", () => {
  it("create_webhook: the HMAC secret never reaches the model (0119, 0123, 0125)", () => {
    const webhook = {
      uid: "wh_1",
      targetUrl: "https://example.invalid/hook",
      events: ["task.completed"],
      secret: WEBHOOK_SECRET,
    };
    const out = scrubToolResult("create_webhook", textResult(webhook));
    const text = firstText(out);
    expect(text).not.toContain(WEBHOOK_SECRET);
    expect(JSON.parse(text)).toEqual({ ...webhook, secret: REDACTED_OUTPUT_VALUE });
  });

  it("create_agent: the agent secret is redacted (0125)", () => {
    const agent = { uid: "ag_1", name: "reviewer", secret: AGENT_SECRET };
    const text = firstText(scrubToolResult("create_agent", textResult(agent)));
    expect(text).not.toContain(AGENT_SECRET);
    expect(JSON.parse(text).secret).toBe(REDACTED_OUTPUT_VALUE);
  });

  it("fleet_register_device: deviceToken is redacted even though the handler emits it raw (0094)", () => {
    const device = { uid: "dev_1", name: "cam-01", deviceToken: DEVICE_TOKEN };
    const text = firstText(
      scrubToolResult("fleet_register_device", textResult(device)),
    );
    expect(text).not.toContain(DEVICE_TOKEN);
    expect(JSON.parse(text).deviceToken).toBe(REDACTED_OUTPUT_VALUE);
  });

  it("non-fleet tools that bypass safeStringify are covered at the boundary (0075)", () => {
    const config = {
      uid: "sc_1",
      provider: "s3",
      credentials: { api_key: "AKIAIOSFODNN7EXAMPLE", secret: "x" },
      clientSecret: "cs_abcdefghijklmnopqrstuvwxyz",
      password: "hunter2",
    };
    const text = firstText(scrubToolResult("get_storage_config", textResult(config)));
    for (const leaked of ["hunter2", "cs_abcdefghijklmnopqrstuvwxyz", "AKIAIOSFODNN7EXAMPLE"]) {
      expect(text).not.toContain(leaked);
    }
  });

  it("redacts nested and array-wrapped payloads, not only top-level keys", () => {
    const listed = [{ uid: "wh_1", secret: WEBHOOK_SECRET }, { uid: "wh_2", nested: { token: DEVICE_TOKEN } }];
    const text = firstText(scrubToolResult("list_webhooks", textResult(listed)));
    expect(text).not.toContain(WEBHOOK_SECRET);
    expect(text).not.toContain(DEVICE_TOKEN);
  });

  it("redacts structuredContent as well as text", () => {
    const out = scrubToolResult("create_webhook", {
      structuredContent: { uid: "wh_1", secret: WEBHOOK_SECRET },
      content: [{ type: "text" as const, text: "created" }],
    });
    expect(out.structuredContent.secret).toBe(REDACTED_OUTPUT_VALUE);
  });
});

describe("what the JSON re-parse must NOT change", () => {
  it("returns a clean pretty-printed payload byte-for-byte", () => {
    const clean = { uid: "wh_1", targetUrl: "https://example.invalid/hook", events: ["a"] };
    const input = textResult(clean);
    expect(firstText(scrubToolResult("create_webhook", input))).toBe(input.content[0]!.text);
  });

  it("keeps a compact payload compact when it does redact", () => {
    const text = firstText(scrubToolResult("x", textResult({ a: 1, secret: "s3cr3t" }, false)));
    expect(text).toBe(JSON.stringify({ a: 1, secret: REDACTED_OUTPUT_VALUE }));
  });

  it("leaves non-JSON text to the value scanner", () => {
    const prose = "Created webhook wh_1 for https://example.invalid/hook";
    expect(firstText(scrubToolResult("x", { content: [{ type: "text" as const, text: prose }] }))).toBe(prose);
  });

  it("does not treat a JSON string or number literal as an object", () => {
    for (const literal of ['"just a string"', "42", "null"]) {
      expect(firstText(scrubToolResult("x", { content: [{ type: "text" as const, text: literal }] }))).toBe(literal);
    }
  });

  it("is idempotent", () => {
    const once = scrubToolResult("create_webhook", textResult({ secret: WEBHOOK_SECRET }));
    expect(scrubToolResult("create_webhook", once)).toEqual(once);
  });

  it("still admits the resolver's deliberately released shape untouched", () => {
    const structured = { url: "https://cdn.example.invalid/a.png", expiresAt: null };
    const result = {
      structuredContent: structured,
      content: [{ type: "text" as const, text: JSON.stringify(structured, null, 2) }],
    };
    expect(scrubToolResult("resolve_asset_handle", result)).toBe(result);
  });
});
