/**
 * The degraded-response contract for composite tools.
 *
 * ## The defect this replaces
 *
 * A composite tool fans out to several routes with `Promise.allSettled` and
 * assembles whatever came back. When one leg failed, the old shape kept the
 * successful skeleton and defaulted the failed part to empty:
 *
 *     devices: { total: 0, online: 0, offline: 0, maintenance: 0 }
 *     errors:  ["devices: AvalaError (HTTP 403)"]
 *
 * An agent reads `total: 0` and tells the user they have no devices. That is a
 * confident wrong answer produced by a silent failure — the §12 hard gate — and
 * it is worse than an error, because an error is self-announcing and a zero is
 * not. `get_workspace_overview` shipped exactly this: `recentProjects: []` with
 * the 403 buried in a nested array.
 *
 * ## The three rules
 *
 * 1. **`degraded` is top-level.** Nested inside `errors` it is not read. The
 *    flag has to be somewhere a model cannot miss while skimming for the
 *    answer it was asked for.
 * 2. **A failed part is ABSENT, never empty.** `[]` and `0` are claims — that
 *    the set is empty, that the count is nil — and a tool may only make a claim
 *    it can support. If we could not look, we say so and omit the field, so
 *    there is no plausible-looking value to misread.
 * 3. **The reason names the next action.** `AvalaError (HTTP 403)` names none.
 *    A machine-readable `status` for the client to key on, and a `remedy` a
 *    human can act on. Prose is not a contract, and a status alone is not a
 *    next step.
 *
 * Reads fail LOUD, which is the read-path counterpart of the Safety Contract's
 * fail-closed posture on writes: never present the absence of an answer as an
 * answer. See `docs/avala-mcp-read-contract.md` §6.
 */

import { z } from "zod";

/** One part of a composite that could not be produced. */
export const unavailablePartSchema = z
  .object({
    part: z.string().describe("Which section of this response is missing"),
    reason: z
      .string()
      .describe("Why it is missing, in terms the caller can act on"),
    remedy: z
      .string()
      .describe("The next action that would make this part available"),
    status: z
      .number()
      .int()
      .optional()
      .describe("Upstream HTTP status, when there was one"),
  })
  .strip();

export type UnavailablePart = z.infer<typeof unavailablePartSchema>;

/**
 * Fields every composite adds when at least one leg failed.
 *
 * `errors` is retained as a **deprecated alias** for one release: existing
 * clients read it, and this repo does not break clients without a migration
 * window. New clients read `degraded` and `unavailable`.
 */
export const degradedFieldsSchema = {
  degraded: z
    .boolean()
    .optional()
    .describe(
      "True when part of this response could not be produced. When true, read `unavailable` before trusting any figure here — missing parts are omitted, not zeroed.",
    ),
  unavailable: z
    .array(unavailablePartSchema)
    .optional()
    .describe("The parts that could not be produced, and what to do about it"),
  errors: z
    .array(z.string())
    .optional()
    .describe("DEPRECATED — use `unavailable`. Retained for one release."),
};

/**
 * Turn a rejected promise into an actionable description.
 *
 * Deliberately does NOT include the raw reason. A rejection commonly carries
 * request URLs, body snippets and stack traces, all of which would land in the
 * model's context and the client's logs.
 */
export function describeUnavailable(
  part: string,
  reason: unknown,
): UnavailablePart {
  const status = httpStatus(reason);
  const described: UnavailablePart = {
    part,
    reason: reasonFor(part, status),
    remedy: remedyFor(part, status),
  };
  return status === undefined ? described : { ...described, status };
}

function httpStatus(reason: unknown): number | undefined {
  if (reason && typeof reason === "object") {
    const candidate = (reason as { statusCode?: unknown }).statusCode;
    if (typeof candidate === "number") return candidate;
  }
  return undefined;
}

function reasonFor(part: string, status: number | undefined): string {
  switch (status) {
    case 401:
      return `${part} unavailable: the credential was not accepted.`;
    case 403:
      return `${part} unavailable: this credential is not permitted to read ${part}.`;
    case 404:
      return `${part} unavailable: the underlying resource does not exist.`;
    case 429:
      return `${part} unavailable: rate limited upstream.`;
    default:
      return status !== undefined && status >= 500
        ? `${part} unavailable: the upstream service failed.`
        : `${part} unavailable: the request did not complete.`;
  }
}

function remedyFor(part: string, status: number | undefined): string {
  switch (status) {
    case 401:
      return "Re-authenticate and retry. If this persists the token may be expired or revoked.";
    case 403:
      // The most common case by far, and the one where a generic message costs
      // the most: the caller can neither fix it nor know who can.
      return `Ask an organization admin to grant read access to ${part}, or use a credential that already has it. Other parts of this response are complete.`;
    case 404:
      return "Check the identifier. It may have been deleted, or belong to another tenant.";
    case 429:
      return "Wait and retry. Reduce the number of concurrent calls if this recurs.";
    default:
      return status !== undefined && status >= 500
        ? "Retry. If it persists this is an Avala-side fault, not a problem with your request."
        : "Retry once. If it persists, report the tool name and the time.";
  }
}

/**
 * Attach the degraded fields to a summary, or return it unchanged.
 *
 * Returning the summary untouched when nothing failed matters: a `degraded:
 * false` on every healthy response trains readers to skip the field, and the
 * one time it says `true` they skip it then too.
 */
export function withDegraded<T extends object>(
  summary: T,
  unavailable: readonly UnavailablePart[],
): T & { degraded?: boolean; unavailable?: UnavailablePart[]; errors?: string[] } {
  if (unavailable.length === 0) return summary;
  return {
    ...summary,
    degraded: true,
    unavailable: [...unavailable],
    // Deprecated alias, same information, old shape.
    errors: unavailable.map((entry) => `${entry.part}: ${entry.reason}`),
  };
}
