/**
 * Migration contract: preserve ALB caller identity by default; an opt-in CF
 * proxy must not turn caller-controlled headers into trusted SDK context.
 * Boundaries: Oct 6 network receipt, Cloudflare HTTP headers / IP ranges docs.
 * These fixtures emulate ALB append; they do not establish live edge behavior.
 */
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { nodeClientIpResolver } from "../src/cloudflareAlbClientIp.js";

const EDGE = "173.245.48.1";
const VISITOR = "203.0.113.42";
const resolve = (mode?: string) => nodeClientIpResolver(mode);

function request(rawHeaders: string[], peer = "127.0.0.1"): IncomingMessage {
  const socket = new Socket();
  Object.defineProperty(socket, "remoteAddress", { value: peer });
  const req = new IncomingMessage(socket);
  req.rawHeaders = rawHeaders;
  return req;
}

function forwarded(edge = EDGE, visitor = VISITOR): string[] {
  return [
    "X-Forwarded-For",
    `spoofed-prefix, ${edge}`,
    "CF-Connecting-IP",
    visitor,
  ];
}

const accepted = (ip: string) => ({ ok: true, forwardedClientIp: ip });
const refused = {
  ok: false,
  status: 400,
  message: "Unable to establish client network context.",
};

describe("Node ingress selection", () => {
  it.each([undefined, "alb"])("keeps the ALB contract for %j", (mode) => {
    expect(resolve(mode)(request(forwarded()))).toEqual(accepted(EDGE));
  });
  it.each(["", "true", "cloudflare", "cloudflare-alb "])(
    "refuses an unknown mode %j at startup",
    (mode) => {
      expect(() => resolve(mode)).toThrow("AVALA_MCP_INGRESS_MODE");
    },
  );
});

describe("Cloudflare before ALB (opt-in)", () => {
  const ingress = resolve("cloudflare-alb");
  it.each([EDGE, "2606:4700::1", "::ffff:173.245.48.1"])(
    "restores ordinary visitor via trusted peer %s",
    (peer) => {
      expect(ingress(request(forwarded(peer)))).toEqual(accepted(VISITOR));
    },
  );
  it.each(["173.245.47.255", "173.245.64.0", "2606:4701::1", "203.0.113.9"])(
    "ignores forged CF identity from untrusted peer %s",
    (peer) => {
      expect(ingress(request(forwarded(peer)))).toEqual(accepted(peer));
    },
  );
  it("does not trust a Cloudflare IP in the attacker-controlled XFF prefix", () => {
    expect(
      ingress(
        request([
          "X-Forwarded-For",
          `${EDGE}, 198.51.100.8`,
          "CF-Connecting-IP",
          VISITOR,
        ]),
      ),
    ).toEqual(accepted("198.51.100.8"));
  });
  it("uses the final appended token across raw header lines", () => {
    expect(
      ingress(request(["X-Forwarded-For", "198.51.100.8", ...forwarded()])),
    ).toEqual(accepted(VISITOR));
  });
  it("does not promote a direct socket peer into ALB provenance", () => {
    expect(ingress(request(["CF-Connecting-IP", VISITOR], EDGE))).toEqual(
      accepted(EDGE),
    );
  });
  it.each([
    ["CF-Worker", "caller.example.com"],
    ["cF-wOrKeR", ""],
    ["CF-Worker", "first.example.com", "cf-worker", "second.example.com"],
  ])(
    "keeps network-peer semantics for any raw Worker marker %j",
    (...marker) => {
      expect(ingress(request([...forwarded(), ...marker]))).toEqual(
        accepted(EDGE),
      );
    },
  );
  it("ignores mutable same-zone and synthetic cross-zone Worker identities", () => {
    for (const visitor of [
      "198.51.100.99",
      "2a06:98c0:3600::103",
      "not-an-ip",
    ]) {
      expect(
        ingress(
          request([...forwarded(EDGE, visitor), "CF-Worker", "avala.ai"]),
        ),
      ).toEqual(accepted(EDGE));
    }
  });
  it.each([
    "",
    "not-an-ip",
    "203.0.113.1, 203.0.113.2",
    " 203.0.113.1",
    "fe80::1%eth0",
    "2001:db8::1]/suffix",
    "2a06:98c0:3600::\t103",
  ])("refuses ambiguous ordinary visitor %j", (visitor) => {
    expect(ingress(request(forwarded(EDGE, visitor)))).toEqual(refused);
  });
  it("refuses missing or duplicate ordinary visitor headers", () => {
    expect(ingress(request(["X-Forwarded-For", EDGE]))).toEqual(refused);
    expect(
      ingress(request([...forwarded(), "cf-connecting-ip", VISITOR])),
    ).toEqual(refused);
  });
  it.each(["2a06:98c0:3600::103", "2A06:98C0:3600:0:0:0:0:103"])(
    "refuses a cross-zone sentinel without Worker provenance %s",
    (visitor) => {
      expect(ingress(request(forwarded(EDGE, visitor)))).toEqual(refused);
    },
  );
  it("refuses unsupported O2O even with an empty marker", () => {
    expect(ingress(request([...forwarded(), "CF-Connecting-O2O", ""]))).toEqual(
      refused,
    );
  });
  it("preserves IPv6 and requires original IPv6 for Pseudo IPv4 overwrite", () => {
    expect(ingress(request(forwarded(EDGE, "2001:db8::42")))).toEqual(
      accepted("2001:db8::42"),
    );
    expect(
      ingress(
        request([
          ...forwarded(EDGE, "240.1.2.3"),
          "CF-Connecting-IPv6",
          "2001:db8::42",
        ]),
      ),
    ).toEqual(accepted("2001:db8::42"));
    for (const headers of [
      [],
      ["CF-Connecting-IPv6", VISITOR],
      [
        "CF-Connecting-IPv6",
        "2001:db8::42",
        "cf-connecting-ipv6",
        "2001:db8::42",
      ],
    ]) {
      expect(
        ingress(request([...forwarded(EDGE, "240.1.2.3"), ...headers])),
      ).toEqual(refused);
    }
  });
  it("ignores extra IPv6 context for a real IPv4 visitor", () => {
    expect(
      ingress(request([...forwarded(), "CF-Connecting-IPv6", "2001:db8::99"])),
    ).toEqual(accepted(VISITOR));
  });
  it("still refuses malformed ALB context before reading CF headers", () => {
    expect(ingress(request(forwarded("bad-peer")))).toEqual(refused);
    expect(ingress(request(forwarded("2001:db8::1]/suffix")))).toEqual(refused);
    expect(ingress(request(forwarded("2a06:98c0:3600::\t103")))).toEqual(
      refused,
    );
  });
});
