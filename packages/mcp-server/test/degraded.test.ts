/**
 * The degraded-response contract (standing brief §6.3, read contract §6).
 *
 * The gate these serve is "silent failure = 0": a confident answer that was
 * wrong because an inner call failed quietly.
 */
import { describe, expect, it } from "vitest";
import {
  describeUnavailable,
  withDegraded,
  type UnavailablePart,
} from "../src/degraded.js";

class AvalaError extends Error {
  constructor(readonly statusCode: number) {
    super("upstream");
    this.name = "AvalaError";
  }
}

describe("describeUnavailable", () => {
  it("turns a 403 into something the caller can act on", () => {
    const part = describeUnavailable("projects", new AvalaError(403));
    expect(part.status).toBe(403);
    // The old text was `AvalaError (HTTP 403)`, which names no next action.
    expect(part.reason).toMatch(/not permitted to read projects/);
    expect(part.remedy).toMatch(/organization admin/);
    // It must also say the rest of the response is trustworthy, or a reader
    // discards good data along with the missing part.
    expect(part.remedy).toMatch(/Other parts of this response are complete/);
  });

  it("distinguishes a refusal from an outage, since the remedies differ", () => {
    expect(describeUnavailable("x", new AvalaError(403)).remedy).toMatch(
      /admin/,
    );
    expect(describeUnavailable("x", new AvalaError(503)).remedy).toMatch(
      /Avala-side fault/,
    );
    expect(describeUnavailable("x", new AvalaError(429)).remedy).toMatch(
      /Wait and retry/,
    );
    expect(describeUnavailable("x", new AvalaError(404)).remedy).toMatch(
      /another tenant/,
    );
  });

  it("never carries the raw rejection into the payload", () => {
    // A rejection commonly holds request URLs, body snippets and stack traces,
    // all of which would land in the model's context and the client's logs.
    const leaky = Object.assign(new AvalaError(500), {
      request: "https://api.avala.ai/v1/projects?token=sekrit",
      stack: "at Object.<anonymous> (/srv/app/secret-path.js:1:1)",
    });
    const serialized = JSON.stringify(describeUnavailable("projects", leaky));
    expect(serialized).not.toContain("sekrit");
    expect(serialized).not.toContain("secret-path");
  });

  it("handles a rejection with no status at all", () => {
    const part = describeUnavailable("projects", new Error("boom"));
    expect(part.status).toBeUndefined();
    expect(part.remedy).toMatch(/Retry once/);
  });
});

describe("withDegraded", () => {
  it("adds nothing when every part succeeded", () => {
    // A `degraded: false` on every healthy response trains readers to skip the
    // field, and then they skip it the one time it says true.
    const summary = { devices: { total: 3 } };
    expect(withDegraded(summary, [])).toEqual(summary);
    expect("degraded" in withDegraded(summary, [])).toBe(false);
  });

  it("puts the flag at the TOP level, not nested in errors", () => {
    const out = withDegraded({ alerts: { totalOpen: 1 } }, [
      describeUnavailable("devices", new AvalaError(403)),
    ]);
    expect(out.degraded).toBe(true);
    expect(out.unavailable).toHaveLength(1);
  });

  it("keeps `errors` as a deprecated alias so existing clients still read", () => {
    const out = withDegraded({}, [
      describeUnavailable("devices", new AvalaError(403)),
    ]);
    expect(out.errors?.[0]).toMatch(/^devices: /);
  });
});

describe("the shape that caused the incident", () => {
  it("omits a failed part instead of zeroing it", () => {
    // This is the whole point. `get_fleet_health` used to return
    // `devices: {total: 0, online: 0}` when the devices call 403'd, and an
    // agent reported "you have no devices" to a user who had plenty.
    const unavailable: UnavailablePart[] = [
      describeUnavailable("devices", new AvalaError(403)),
    ];
    const out = withDegraded(
      { alerts: { totalOpen: 2, bySeverity: { high: 2 } } },
      unavailable,
    ) as Record<string, unknown>;

    expect(out.devices).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('"total":0');
    // and the part that DID succeed is present and unqualified
    expect(out.alerts).toEqual({ totalOpen: 2, bySeverity: { high: 2 } });
  });

  it("an empty array must mean empty, never unread", () => {
    // A successful call that genuinely returned nothing still emits [].
    // That claim is only allowed when we actually looked.
    const out = withDegraded({ recentProjects: [] }, []) as Record<
      string,
      unknown
    >;
    expect(out.recentProjects).toEqual([]);
    expect(out.degraded).toBeUndefined();
  });
});
