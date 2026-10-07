import { BlockList, isIP } from "node:net";
import type { IncomingMessage } from "node:http";
import { validateForwardedClientIp } from "@avala-ai/sdk";
import {
  extractForwardedClientIp,
  headerValues,
  type ClientIp,
} from "./httpServer.js";

// Official proxy networks retrieved 2026-10-06. Review both lists before enabling
// this mode and when Cloudflare changes its ranges; never fetch trust at runtime.
// https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6
const CLOUDFLARE_NETWORKS = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
] as const;
const cloudflarePeers = new BlockList();
for (const network of CLOUDFLARE_NETWORKS) {
  const [address, prefix] = network.split("/") as [string, string];
  cloudflarePeers.addSubnet(
    address,
    Number(prefix),
    isIP(address) === 6 ? "ipv6" : "ipv4",
  );
}
const workerSentinel = new BlockList();
workerSentinel.addAddress("2a06:98c0:3600::103", "ipv6");

function refused(): ClientIp {
  return {
    ok: false,
    status: 400,
    message: "Unable to establish client network context.",
  };
}

/**
 * Node-only opt-in for Cloudflare -> ALB (append, no client port) -> MCP.
 * The task must still accept ingress only from the ALB. The final appended peer
 * proves a Cloudflare network connection, NOT which Cloudflare zone sent it.
 * CF-Worker is a presence check: Worker scripts can alter same-zone client IPs.
 * Live topology and downstream provenance acceptance is required before enablement.
 * https://developers.cloudflare.com/fundamentals/reference/http-headers/
 */
function cloudflareAlbClientIp(request: IncomingMessage): ClientIp {
  const peer = extractForwardedClientIp(request);
  if (!peer.ok) return peer;
  const peerFamily = isIP(peer.forwardedClientIp);
  if (peerFamily === 0) return refused();
  if (
    headerValues(request, "x-forwarded-for").length === 0 ||
    !cloudflarePeers.check(
      peer.forwardedClientIp,
      peerFamily === 6 ? "ipv6" : "ipv4",
    )
  )
    return peer;

  // Preserve the established network-peer rule for Worker callers. Do not
  // accept their mutable visitor claim, even for our own zone or an empty marker.
  if (headerValues(request, "cf-worker").length > 0) return peer;
  if (headerValues(request, "cf-connecting-o2o").length > 0) return refused();

  const values = headerValues(request, "cf-connecting-ip");
  if (values.length !== 1) return refused();
  let candidate = values[0]!;
  try {
    // Parse the entire literal before the SDK's cross-runtime validation.
    // WHATWG URL parsing can otherwise normalize controls or accept a suffix.
    if (isIP(candidate) === 0) return refused();
    validateForwardedClientIp(candidate, { required: true });
    if (isIP(candidate) === 4 && Number(candidate.split(".")[0]) >= 240) {
      const ipv6 = headerValues(request, "cf-connecting-ipv6");
      if (ipv6.length !== 1 || isIP(ipv6[0]) !== 6) return refused();
      candidate = ipv6[0]!;
      validateForwardedClientIp(candidate, { required: true });
    }
    if (isIP(candidate) === 6 && workerSentinel.check(candidate, "ipv6"))
      return refused();
    return { ok: true, forwardedClientIp: candidate };
  } catch {
    return refused();
  }
}

/** Unknown configuration fails at startup; absence retains current ALB behavior. */
export function nodeClientIpResolver(
  mode = "alb",
): (request: IncomingMessage) => ClientIp {
  if (mode === "alb") return extractForwardedClientIp;
  if (mode === "cloudflare-alb") return cloudflareAlbClientIp;
  throw new Error("AVALA_MCP_INGRESS_MODE must be alb or cloudflare-alb.");
}
