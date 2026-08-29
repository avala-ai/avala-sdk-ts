/**
 * Cassette layer for the MCP eval harness.
 *
 * WHY IT INTERCEPTS UPSTREAM HTTP RATHER THAN THE MCP PROTOCOL
 * -----------------------------------------------------------
 * The thing under evaluation is the MCP server itself — its tool names, its
 * schemas, its error text and the SIZE of what it hands back. Stubbing at the
 * MCP layer would replace exactly that. So the real server binary runs, speaks
 * real MCP over stdio, and its REST calls are pointed at this local HTTP server
 * via `AVALA_BASE_URL`. Everything between the model and the REST boundary is
 * production code.
 *
 * REPLAY (default)
 *   Serves recorded responses keyed by method + path + sorted query string.
 *   A miss is LOUD: it is logged to stderr, recorded in `misses`, and answered
 *   with an explicit error naming the unmatched request. It never falls through
 *   to the network and never returns a silently empty body — a quietly empty
 *   response would look to the model like "no results", which is precisely the
 *   silent-failure mode the eval exists to detect.
 *
 * RECORD (`--live`)
 *   Proxies to the real API, scrubs the response (see `scrub.ts`), writes the
 *   cassette, then serves it. Request headers — which carry the API key — are
 *   never written to disk.
 *
 * Binds to 127.0.0.1 only.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { findSecrets, formatFindings, scrubForCassette } from "./scrub.js";

export interface CassetteKey {
  readonly method: string;
  readonly path: string;
  /** Query string with parameters sorted by name, so ordering never splits a key. */
  readonly query: string;
}

export interface Cassette {
  readonly key: CassetteKey;
  readonly status: number;
  readonly body: unknown;
  /** ISO timestamp of the recording, for cassette staleness triage. */
  readonly recordedAt?: string;
}

export interface CassetteMiss {
  readonly method: string;
  readonly url: string;
  readonly key: string;
  readonly at: string;
}

export interface CassetteServerOptions {
  readonly cassetteDir: string;
  /** `true` proxies to `upstreamBaseUrl` and records. Default `false` (replay). */
  readonly record?: boolean;
  /** Real API root used in record mode. */
  readonly upstreamBaseUrl?: string;
}

export interface RunningCassetteServer {
  /** Base URL to hand the server under test as `AVALA_BASE_URL`. */
  readonly baseUrl: string;
  readonly misses: readonly CassetteMiss[];
  /** Requests served this run, in order. Shapes and counts only — never bodies. */
  readonly served: readonly { key: string; status: number; bytes: number }[];
  /** Live cassette map, so probe assertions can run after a record pass. */
  readonly cassettes: ReadonlyMap<string, Cassette>;
  close(): Promise<void>;
}

/** The API root the SDK appends paths to. Kept out of the cassette key. */
const BASE_PATH = "/api/v1";

export function cassetteKey(method: string, rawUrl: string): CassetteKey {
  const url = new URL(rawUrl, "http://cassette.local");
  let path = url.pathname;
  if (path.startsWith(BASE_PATH)) path = path.slice(BASE_PATH.length) || "/";

  const params = [...url.searchParams.entries()].sort(([a], [b]) =>
    a === b ? 0 : a < b ? -1 : 1,
  );
  const query = params.map(([name, value]) => `${name}=${value}`).join("&");
  return { method: method.toUpperCase(), path, query };
}

export function keyString(key: CassetteKey): string {
  return key.query ? `${key.method} ${key.path}?${key.query}` : `${key.method} ${key.path}`;
}

/** Stable, human-readable cassette filename. */
export function cassetteFileName(key: CassetteKey): string {
  const slug =
    key.path
      .replace(/^\/+|\/+$/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "root";
  const hash = createHash("sha256").update(keyString(key), "utf8").digest("hex").slice(0, 8);
  return `${key.method.toLowerCase()}_${slug}_${hash}.json`;
}

export async function loadCassettes(dir: string): Promise<Map<string, Cassette>> {
  const map = new Map<string, Cassette>();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return map;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const raw = await readFile(join(dir, entry), "utf8");
    let parsed: Cassette;
    try {
      parsed = JSON.parse(raw) as Cassette;
    } catch (error) {
      throw new Error(`Cassette ${entry} is not valid JSON: ${(error as Error).message}`);
    }
    if (!parsed.key?.method || !parsed.key?.path) {
      throw new Error(`Cassette ${entry} is missing a key.method/key.path.`);
    }
    map.set(keyString(parsed.key), parsed);
  }
  return map;
}

function sendJson(response: ServerResponse, status: number, body: unknown): number {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
  });
  response.end(text);
  return Buffer.byteLength(text);
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function startCassetteServer(
  options: CassetteServerOptions,
): Promise<RunningCassetteServer> {
  const { cassetteDir, record = false } = options;
  const upstreamBaseUrl = (options.upstreamBaseUrl ?? "https://api.avala.ai/api/v1").replace(
    /\/+$/,
    "",
  );
  await mkdir(cassetteDir, { recursive: true });
  const cassettes = await loadCassettes(cassetteDir);

  const misses: CassetteMiss[] = [];
  const served: { key: string; status: number; bytes: number }[] = [];

  const server: Server = createServer((request, response) => {
    void (async () => {
      const key = cassetteKey(request.method ?? "GET", request.url ?? "/");
      const label = keyString(key);

      const existing = cassettes.get(label);
      if (existing) {
        const bytes = sendJson(response, existing.status, existing.body);
        served.push({ key: label, status: existing.status, bytes });
        return;
      }

      if (!record) {
        misses.push({
          method: key.method,
          url: request.url ?? "/",
          key: label,
          at: new Date().toISOString(),
        });
        // Loud on stderr, and ACTIONABLE: the agent explores nondeterministically,
        // so across trials it will not reproduce the call sequence used at
        // record time. Misses are therefore the expected way coverage grows, and
        // the message has to say exactly what to top up and how — a bare "miss"
        // leaves the reader diffing cassette filenames by hand.
        // (stdout belongs to the MCP stdio transport; never log there.)
        console.error(
          `[cassette] MISS  ${key.method} ${key.path}${key.query ? `?${key.query}` : ""}\n` +
            `[cassette]   method : ${key.method}\n` +
            `[cassette]   path   : ${key.path}\n` +
            `[cassette]   query  : ${key.query || "(none)"}\n` +
            `[cassette]   file   : ${cassetteFileName(key)}\n` +
            "[cassette]   top up : make eval-record       (all tasks)\n" +
            "[cassette]            make eval-record TASK=<id>  (one task, id from eval/tasks/*.xml)\n" +
            "[cassette]            Record mode APPENDS — existing cassettes are never rewritten,\n" +
            "[cassette]            so re-running it only fills gaps. Deliberately refreshing one\n" +
            "[cassette]            means deleting that file first.",
        );
        const bytes = sendJson(response, 501, {
          detail:
            `Cassette miss: no recorded response for ${label}. ` +
            "The eval harness is in replay mode and will not reach the network. " +
            "This is a HARNESS gap, not a failure of the data being requested.",
        });
        served.push({ key: label, status: 501, bytes });
        return;
      }

      // ---- record mode -----------------------------------------------------
      const requestBody = await readRequestBody(request);
      const upstreamUrl = `${upstreamBaseUrl}${key.path}${key.query ? `?${key.query}` : ""}`;
      const forwardHeaders: Record<string, string> = { Accept: "application/json" };
      for (const name of [
        "x-avala-api-key",
        "authorization",
        "x-avala-client",
        "content-type",
      ]) {
        const value = request.headers[name];
        if (typeof value === "string") forwardHeaders[name] = value;
      }

      let upstream: Response;
      try {
        upstream = await fetch(upstreamUrl, {
          method: key.method,
          headers: forwardHeaders,
          body: requestBody.length > 0 ? requestBody : undefined,
          redirect: "manual",
        });
      } catch (error) {
        console.error(`[cassette] upstream error for ${label}: ${(error as Error).message}`);
        sendJson(response, 502, { detail: `Upstream fetch failed for ${label}.` });
        return;
      }

      const text = await upstream.text();
      let body: unknown;
      try {
        body = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        body = { detail: "Non-JSON upstream response", raw: text.slice(0, 2000) };
      }

      // SCRUB ON WRITE. Nothing unscrubbed ever reaches the filesystem.
      const scrubbed = scrubForCassette(body);
      const leftovers = findSecrets(scrubbed);
      if (leftovers.length > 0) {
        // A scrubber that let something through must not be allowed to write.
        console.error(
          `[cassette] REFUSING to write ${label}: scrubbed body still contains secrets:\n` +
            formatFindings(leftovers),
        );
        sendJson(response, 500, { detail: `Refused to record ${label}: scrub incomplete.` });
        return;
      }

      const cassette: Cassette = {
        key,
        status: upstream.status,
        body: scrubbed,
        recordedAt: new Date().toISOString(),
      };
      // APPEND-ONLY across passes. Coverage is built up over several record
      // runs as the agent explores different paths, so a later pass must add
      // interactions rather than rewrite the set — otherwise each pass churns
      // every previously recorded file and the diffs become unreviewable.
      // `wx` fails if the file exists, which is the guarantee we want; a
      // deliberate refresh means deleting the file first.
      try {
        await writeFile(
          join(cassetteDir, cassetteFileName(key)),
          `${JSON.stringify(cassette, null, 2)}\n`,
          { encoding: "utf8", flag: "wx" },
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        console.error(`[cassette] kept existing recording for ${label} (append-only)`);
      }
      cassettes.set(label, cassette);
      console.error(`[cassette] recorded ${label} -> ${cassetteFileName(key)}`);

      const bytes = sendJson(response, cassette.status, cassette.body);
      served.push({ key: label, status: cassette.status, bytes });
    })().catch((error: unknown) => {
      console.error(`[cassette] handler error: ${(error as Error).message}`);
      if (!response.headersSent) sendJson(response, 500, { detail: "Cassette server error." });
    });
  });

  await new Promise<void>((resolve) => {
    // 127.0.0.1 only — never expose a recording proxy on a routable interface.
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Cassette server did not bind to a TCP port.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}${BASE_PATH}`,
    misses,
    served,
    cassettes,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

// ---------------------------------------------------------------------------
// Non-existence probes
// ---------------------------------------------------------------------------

/**
 * Identifiers that two adversarial tasks assert do NOT exist.
 *
 * These are the suite's fabrication probes: they ask the agent about an entity
 * that is not there and check whether it invents a plausible record. If either
 * identifier is ever created in the tenant, the task silently INVERTS — the
 * agent finds a real record, answers correctly, and the task passes while
 * measuring nothing. The report still reads green.
 *
 * That is the defect class in `.claude/rules/ci-green-means-tested.md` §5: the
 * test runs, the assertion executes, and it proves nothing. So the assertion is
 * made against the recorded cassettes themselves, where a 2xx is proof that the
 * premise has failed.
 *
 * `taskId` is the owning task's permanent `id`. `test/evalTasks.test.ts` asserts
 * each identifier still appears in that task's text, so renaming a slug in the
 * task file fails the build instead of leaving a probe guarding nothing.
 */
export const NON_EXISTENCE_PROBES: readonly {
  readonly taskId: string;
  readonly identifier: string;
}[] = [
  { taskId: "adv-missing-dataset-slug", identifier: "helsinki-winter-radar-v3" },
  { taskId: "adv-missing-coworker-handle", identifier: "m.wanjiru-4471" },
];

export interface ProbeViolation {
  readonly identifier: string;
  readonly taskId: string;
  readonly cassetteKey: string;
  readonly status: number;
}

/**
 * Fail if any cassette proves a supposedly-absent entity actually exists.
 *
 * A 2xx for a request naming one of these identifiers means the tenant now has
 * the entity, so the task built on its absence is measuring the opposite of what
 * it claims. Run this after a record pass AND at replay startup — a cassette set
 * recorded months ago can go stale the moment somebody creates that slug.
 */
export function findNonExistenceViolations(
  cassettes: ReadonlyMap<string, Cassette>,
): ProbeViolation[] {
  const violations: ProbeViolation[] = [];
  for (const [label, cassette] of cassettes) {
    if (cassette.status < 200 || cassette.status >= 300) continue;
    const haystack = `${label}\n${JSON.stringify(cassette.body)}`;
    for (const probe of NON_EXISTENCE_PROBES) {
      // Match the identifier in the REQUEST (a lookup that succeeded) or in a
      // response body (it turned up in a listing).
      if (!haystack.includes(probe.identifier)) continue;
      violations.push({
        identifier: probe.identifier,
        taskId: probe.taskId,
        cassetteKey: label,
        status: cassette.status,
      });
    }
  }
  return violations;
}

/** Human-readable explanation of why a violation invalidates the suite. */
export function formatProbeViolations(violations: readonly ProbeViolation[]): string {
  return violations
    .map(
      (violation) =>
        `  ${violation.identifier} (task ${violation.taskId}) returned HTTP ${violation.status} ` +
        `for ${violation.cassetteKey}.\n` +
        "    That entity was supposed NOT to exist. The task built on its absence now passes " +
        "for the wrong reason and measures nothing.\n" +
        "    Fix: pick an identifier that collides with nothing, update the task file, and " +
        "re-record.",
    )
    .join("\n");
}
