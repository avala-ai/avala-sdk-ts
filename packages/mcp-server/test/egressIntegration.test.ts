/**
 * End-to-end: the REAL tool registry, not a fake server.
 *
 * `egress.test.ts` proves the wrapper works. This proves it is actually wired
 * into the server every entry point builds — which is the part that was
 * missing before, since 24 tools were individually correct-looking and
 * collectively unprotected.
 */
import { describe, expect, it } from "vitest";
import { TOOL_REGISTRARS } from "../src/server.js";
import { enforceEgressScrubbing } from "../src/egress.js";
import { findSecrets } from "../src/secrets.js";

const LEAKY = {
  logo:
    "https://x.s3.amazonaws.com/l.png?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE" +
    "&Signature=abc%3D&x-amz-security-token=FwoGZXIvYXdzEEXAMPLETOKEN",
  contact: "reviewer@avala.ai",
};

describe("every registered tool is behind the egress boundary", () => {
  it("wraps the handler of every tool in the real registry", () => {
    // Proof by identity comparison, not by "the recorded value is a function".
    // Register the SAME registrars twice — once through a bare stub, once
    // through the wrapped one — and assert every tool's recorded handler
    // differs. If any tool escaped the wrapper, its two handlers are the same
    // object and that tool is named in the failure.
    function collect(wrap: boolean): Map<string, unknown> {
      const seen = new Map<string, unknown>();
      const stub = {
        registerTool: (name: string, _c: unknown, ...rest: unknown[]): string => {
          const handler = rest.find((r) => typeof r === "function");
          if (handler) seen.set(name, handler);
          return name;
        },
      };
      const server = wrap
        ? (enforceEgressScrubbing(stub as never) as unknown as typeof stub)
        : stub;
      const getClient = (): never => {
        throw new Error("no client during registration");
      };
      for (const registrar of TOOL_REGISTRARS) {
        registrar.register(server as never, getClient as never, {
          allowMutations: true,
        });
      }
      return seen;
    }

    const bare = collect(false);
    const wrapped = collect(true);

    expect(bare.size).toBeGreaterThan(50);
    expect([...wrapped.keys()].sort()).toEqual([...bare.keys()].sort());

    const unwrapped = [...bare.keys()].filter(
      (name) => wrapped.get(name) === bare.get(name),
    );
    expect(unwrapped).toEqual([]);
  });

  it("a leaky result from any wrapped registration is scrubbed", async () => {
    const captured: ((...a: unknown[]) => unknown)[] = [];
    const stub = {
      registerTool: (_n: string, _c: unknown, ...rest: unknown[]): string => {
        const h = rest.find((r) => typeof r === "function");
        if (h) captured.push(h as never);
        return "t";
      },
    };
    const server = enforceEgressScrubbing(stub as never) as unknown as typeof stub;
    server.registerTool("any_future_tool", {}, async () => LEAKY);

    const out = await captured[0]!();
    expect(findSecrets(out)).toEqual([]);
    expect(JSON.stringify(out)).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(JSON.stringify(out)).not.toContain("reviewer@avala.ai");
  });
});
