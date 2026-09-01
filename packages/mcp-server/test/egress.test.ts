/**
 * The leakage hard gate (standing brief §12: secret/PII leakage = 0).
 *
 * These tests are written against the payload that ACTUALLY shipped, not an
 * invented one. The `logo` URL and `exportSnippet` below are the shapes
 * observed leaving `list_datasets` and `get_frame` on 2026-08-28, with the
 * credential material replaced by same-shape fakes.
 */
import { describe, expect, it } from "vitest";
import { sanitizeForOutput } from "../src/redact.js";
import { findSecrets } from "../src/secrets.js";
import { enforceEgressScrubbing, scrubToolResult } from "../src/egress.js";

/** Same shape as a real presigned S3 URL; the credential parts are fake. */
const SIGNED_URL =
  "https://avala-x.s3.amazonaws.com/logo.png?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE" +
  "&Signature=vjbyPxybstBGRAmkkKrOVwZKrht%3D&x-amz-security-token=FwoGZXIvYXdzEEXAMPLETOKEN";

const LEAKY_RESPONSE = {
  logo: SIGNED_URL,
  exportSnippet: {
    annotator: "Jane Doe",
    reviewerEmail: "reviewer@avala.ai",
    username: "+254712345678",
  },
};

describe("the defect this gate exists for", () => {
  it("key-name redaction alone leaves the credential intact", () => {
    // Not a hypothetical: this is why `egress.ts` exists. `AWSAccessKeyId` IS
    // in redact.ts's deny-list, as a KEY NAME — it cannot reach a query
    // parameter inside a string value.
    const redacted = sanitizeForOutput(LEAKY_RESPONSE) as typeof LEAKY_RESPONSE;
    expect(redacted.logo).toBe(SIGNED_URL);
    expect(redacted.exportSnippet.annotator).toBe("Jane Doe");
  });

  it("the value-level scanner sees what key-name matching cannot", () => {
    const kinds = findSecrets(LEAKY_RESPONSE).map((f) => f.kind);
    expect(kinds).toContain("aws-access-key-id");
    // The signature and STS token classify as `aws-credential-param`; the
    // access key id gets its own kind. Asserted by observation, not by what
    // the kind names sounded like they should be.
    expect(kinds.filter((k) => k === "aws-credential-param")).toHaveLength(2);
    expect(kinds).toContain("email");
    expect(kinds).toContain("phone-e164");
  });

  it("findings never reproduce the secret they report", () => {
    // Findings are printed in test failures and logs. A finding that quoted the
    // match would make the reporter a new place the credential lands.
    for (const finding of findSecrets(LEAKY_RESPONSE)) {
      expect(SIGNED_URL).not.toContain(finding.sample);
      expect(finding.sample).not.toContain("AKIAIOSFODNN7EXAMPLE");
    }
  });
});

describe("what this gate does NOT cover", () => {
  it("does not remove a bare human name — names are not detectable by pattern", () => {
    // Pinned deliberately, so nobody reads "leakage gate" and assumes
    // attribution is handled here. `annotator: "Jane Doe"` is indistinguishable
    // from any other short string; no regex closes that, and one that tried
    // would maul ordinary content.
    //
    // Annotator and reviewer identity is governed at the TOOL boundary instead:
    // absent from default responses, gated behind an explicit
    // `include_attribution`, never present in a list shape
    // (`docs/avala-mcp-read-contract.md` §3.2). This gate is the net under
    // that, not a replacement for it.
    const scrubbed = scrubToolResult("get_frame", LEAKY_RESPONSE) as typeof LEAKY_RESPONSE;
    expect(scrubbed.exportSnippet.annotator).toBe("Jane Doe");
  });
});

describe("scrubToolResult", () => {
  it("removes every credential and personal field", () => {
    const scrubbed = scrubToolResult("get_frame", LEAKY_RESPONSE);
    expect(findSecrets(scrubbed)).toEqual([]);
    expect(JSON.stringify(scrubbed)).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(JSON.stringify(scrubbed)).not.toContain("+254712345678");
  });

  it("is idempotent, so a double-wrapped handler cannot mangle output", () => {
    const once = scrubToolResult("t", LEAKY_RESPONSE);
    expect(scrubToolResult("t", once)).toEqual(once);
  });

  it("leaves clean payloads untouched", () => {
    const clean = { uid: "ds_1", name: "sf-lidar", sequenceCount: 39 };
    expect(scrubToolResult("list_datasets", clean)).toEqual(clean);
  });

  it("permits only the resolver's exact, deliberately released URL shape", () => {
    const structuredContent = { url: SIGNED_URL, expiresAt: null };
    const result = {
      structuredContent,
      content: [
        {
          type: "text",
          text: JSON.stringify(structuredContent, null, 2),
        },
      ],
    };

    expect(scrubToolResult("resolve_asset_handle", result)).toEqual(result);
    expect(JSON.stringify(scrubToolResult("get_frame", result))).not.toContain(
      "AKIAIOSFODNN7EXAMPLE",
    );
  });

  it("falls back to universal scrubbing if resolver output grows any extra field", () => {
    const structuredContent = {
      url: SIGNED_URL,
      expiresAt: null,
      accidental: "reviewer@example.com",
    };
    const result = {
      structuredContent,
      content: [
        {
          type: "text",
          text: JSON.stringify(structuredContent, null, 2),
        },
      ],
    };

    const scrubbed = scrubToolResult("resolve_asset_handle", result);
    expect(findSecrets(scrubbed)).toEqual([]);
    expect(JSON.stringify(scrubbed)).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(JSON.stringify(scrubbed)).not.toContain("reviewer@example.com");
  });

  it("falls back to universal scrubbing for an unsafe resolver URL", () => {
    const structuredContent = {
      url: "https://AKIAIOSFODNN7EXAMPLE:secret@example.com/export.zip",
      expiresAt: null,
    };
    const result = {
      structuredContent,
      content: [
        {
          type: "text",
          text: JSON.stringify(structuredContent, null, 2),
        },
      ],
    };

    const scrubbed = scrubToolResult("resolve_asset_handle", result);
    expect(findSecrets(scrubbed)).toEqual([]);
    expect(JSON.stringify(scrubbed)).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("falls back to universal scrubbing for a non-canonical expiry", () => {
    const structuredContent = {
      url: SIGNED_URL,
      expiresAt: "August 29, 2026 09:00 UTC",
    };
    const result = {
      structuredContent,
      content: [
        {
          type: "text",
          text: JSON.stringify(structuredContent, null, 2),
        },
      ],
    };

    const scrubbed = scrubToolResult("resolve_asset_handle", result);
    expect(findSecrets(scrubbed)).toEqual([]);
    expect(JSON.stringify(scrubbed)).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });
});

describe("enforceEgressScrubbing", () => {
  interface Registered {
    name: string;
    handler: (...a: unknown[]) => unknown;
  }

  function fakeServer(sink: Registered[]): {
    registerTool: (n: string, c: unknown, h: (...a: unknown[]) => unknown) => string;
  } {
    return {
      registerTool: (name, _config, handler): string => {
        sink.push({ name, handler });
        return name;
      },
    };
  }

  it("scrubs an async handler's result", async () => {
    const sink: Registered[] = [];
    const server = enforceEgressScrubbing(
      fakeServer(sink) as never,
    ) as unknown as ReturnType<typeof fakeServer>;
    server.registerTool("get_frame", {}, async () => LEAKY_RESPONSE);

    const out = await sink[0]!.handler();
    expect(findSecrets(out)).toEqual([]);
  });

  it("scrubs a SYNC handler without converting it to a promise", () => {
    // Normalising with Promise.resolve would silently change a sync handler's
    // contract, so the wrapper branches instead.
    const sink: Registered[] = [];
    const server = enforceEgressScrubbing(
      fakeServer(sink) as never,
    ) as unknown as ReturnType<typeof fakeServer>;
    server.registerTool("sync_tool", {}, () => LEAKY_RESPONSE);

    const out = sink[0]!.handler();
    expect(out).not.toBeInstanceOf(Promise);
    expect(findSecrets(out)).toEqual([]);
  });

  it("covers a tool registered without reading egress.ts — the whole point", () => {
    // A hand-written tool that does its own JSON.stringify and never calls a
    // redaction helper. 24 of these existed; they leaked precisely because
    // coverage was opt-in.
    const sink: Registered[] = [];
    const server = enforceEgressScrubbing(
      fakeServer(sink) as never,
    ) as unknown as ReturnType<typeof fakeServer>;
    server.registerTool("careless_tool", {}, () => ({
      content: [{ type: "text", text: JSON.stringify(LEAKY_RESPONSE, null, 2) }],
    }));

    const out = sink[0]!.handler();
    expect(JSON.stringify(out)).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(findSecrets(out)).toEqual([]);
  });

  it("passes non-function registration arguments through untouched", () => {
    const sink: Registered[] = [];
    const server = enforceEgressScrubbing(
      fakeServer(sink) as never,
    ) as unknown as ReturnType<typeof fakeServer>;
    const config = { description: "x" };
    server.registerTool("t", config, () => ({}));
    expect(sink[0]!.name).toBe("t");
  });

  it("rejects a non-string tool name rather than silently skipping it", () => {
    const sink: Registered[] = [];
    const server = enforceEgressScrubbing(
      fakeServer(sink) as never,
    ) as unknown as ReturnType<typeof fakeServer>;
    expect(() =>
      (server.registerTool as unknown as (n: unknown) => void)(42),
    ).toThrow(/must be a string/);
  });
});
