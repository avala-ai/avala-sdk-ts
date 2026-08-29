/**
 * Value-scanning secret/PII detection and stable scrubbing for eval cassettes.
 *
 * WHY THIS EXISTS SEPARATELY FROM `src/redact.ts`
 * ------------------------------------------------
 * `src/redact.ts` matches KEY NAMES only. That is the right shape for its job
 * (defense-in-depth on tool output), but it cannot see a credential sitting in
 * the VALUE of an innocuous key. Verified against the shipped implementation:
 *
 *     sanitizeForOutput({ logo: "https://s3/…?AWSAccessKeyId=AKIA…&Signature=…" })
 *
 * passes through completely unchanged, because `logo` is not a sensitive key
 * name. Cassettes are recorded from the real API and then COMMITTED TO GIT, so
 * a key-name filter is not enough: we must scan every string value, anywhere in
 * the payload, at any depth.
 *
 * STABILITY IS A HARD REQUIREMENT
 * -------------------------------
 * Every placeholder is derived from a SHA-256 of the original text, so the same
 * input always produces the same placeholder. Random placeholders would make
 * every re-record churn every cassette and turn the diffs into noise, which is
 * how nobody reviews them any more.
 *
 * PLACEHOLDERS MUST NOT LOOK LIKE SECRETS
 * ---------------------------------------
 * `test/evalCassettes.test.ts` runs `findSecrets` over every committed cassette
 * and fails the build on any hit. So a placeholder that preserved the SHAPE of
 * the thing it replaced (a fake `eyJ…` JWT, a fake `AKIA…` key id, a fake
 * `user@host` address) would be re-detected and fail that gate forever. Every
 * placeholder is therefore an unmistakable `[scrubbed:<kind>:<hash>]` marker,
 * and the scanner blanks existing markers out before it looks for anything, so
 * scrubbing is idempotent.
 */

import { createHash } from "node:crypto";

export type SecretKind =
  | "aws-access-key-id"
  | "aws-credential-param"
  | "signed-url-param"
  | "jwt"
  | "bearer-token"
  | "email"
  | "phone-e164";

export interface Finding {
  /** JSON-ish path to the string that contained the match, e.g. `body.results[0].logo`. */
  readonly path: string;
  readonly kind: SecretKind;
  /**
   * A non-reproducing description of what matched: the first few characters,
   * the length, and a stable digest. Deliberately NOT the raw secret — findings
   * are printed in test failures and logs.
   */
  readonly sample: string;
}

interface Match {
  readonly start: number;
  readonly end: number;
  readonly kind: SecretKind;
}

/** Marker emitted by `scrubString`. Blanked before detection so scrubbing is idempotent. */
const PLACEHOLDER_PATTERN = /\[scrubbed:[a-z0-9-]+:[0-9a-f]{8}\]/g;

/**
 * Query parameters whose value is a credential or a signature. Matched
 * case-insensitively because S3 presigned URLs and SDKs disagree on casing
 * (`AWSAccessKeyId` vs `X-Amz-Credential` vs `x-amz-security-token`).
 */
const CREDENTIAL_PARAM_NAMES = [
  "awsaccesskeyid",
  "x-amz-security-token",
  "x-amz-credential",
  "x-amz-signature",
  "signature",
  "sig",
  "token",
  "access_token",
  "accesstoken",
  "id_token",
  "refresh_token",
  "api_key",
  "apikey",
  "key",
  "secret",
  "password",
  "credential",
  "auth",
];

/**
 * Params that are credential-bearing by NAME regardless of value length. The
 * rest of `CREDENTIAL_PARAM_NAMES` (notably `key`, which S3 also uses for the
 * harmless object path) only counts when the value is long and opaque.
 */
const ALWAYS_CREDENTIAL_PARAMS = new Set([
  "awsaccesskeyid",
  "x-amz-security-token",
  "x-amz-credential",
  "x-amz-signature",
  "signature",
  "access_token",
  "accesstoken",
  "id_token",
  "refresh_token",
  "api_key",
  "apikey",
  "secret",
  "password",
  "credential",
]);

/** Below this, an opaque-looking value is more likely an id than a signature. */
const OPAQUE_VALUE_MIN_LENGTH = 20;

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function short(text: string): string {
  return digest(text).slice(0, 8);
}

/** Replace placeholder markers with spaces so match offsets stay aligned. */
function maskPlaceholders(text: string): string {
  return text.replace(PLACEHOLDER_PATTERN, (marker) => " ".repeat(marker.length));
}

function pushMatch(matches: Match[], start: number, end: number, kind: SecretKind): void {
  if (end <= start) return;
  matches.push({ start, end, kind });
}

/**
 * Find every credential/PII span inside a single string.
 *
 * Detectors deliberately overlap (a presigned URL trips both the `AKIA…` key-id
 * rule and the credential-parameter rule). Overlaps are resolved in
 * `resolveMatches` by keeping the widest span, so the scrubbed output never
 * contains a half-replaced secret.
 */
function scanString(raw: string): Match[] {
  const text = maskPlaceholders(raw);
  const matches: Match[] = [];

  // 1. AWS long-term (AKIA) and temporary (ASIA) access key ids.
  for (const match of text.matchAll(/\b(?:AKIA|ASIA)[0-9A-Z]{12,20}\b/g)) {
    pushMatch(matches, match.index, match.index + match[0].length, "aws-access-key-id");
  }

  // 2. JWTs — three base64url segments, header starting `eyJ`.
  for (const match of text.matchAll(
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g,
  )) {
    pushMatch(matches, match.index, match.index + match[0].length, "jwt");
  }

  // 3. `Authorization: Bearer <token>` / `Token <token>` in a header-ish string.
  //    The token itself is the secret; the scheme word is left readable.
  for (const match of text.matchAll(/\b(?:Bearer|Token)\s+([A-Za-z0-9._~+/=-]{16,})/gi)) {
    const tokenStart = match.index + match[0].length - match[1].length;
    pushMatch(matches, tokenStart, tokenStart + match[1].length, "bearer-token");
  }

  // 4. Credential-bearing query parameters. Scanning the raw string rather than
  //    parsing as a URL, because these also show up inside JSON blobs, log
  //    lines and `next`/`previous` pagination fields that are not valid URLs on
  //    their own.
  for (const match of text.matchAll(/([A-Za-z0-9_.\-]{2,40})=([^&"'\s\\]{1,})/g)) {
    const name = (match[1] ?? "").toLowerCase();
    const value = match[2] ?? "";
    if (!CREDENTIAL_PARAM_NAMES.includes(name)) continue;
    const always = ALWAYS_CREDENTIAL_PARAMS.has(name);
    if (!always && value.length < OPAQUE_VALUE_MIN_LENGTH) continue;
    // A blanked placeholder leaves spaces, which the value pattern already
    // stops at; an empty remainder means there is nothing secret left here.
    if (value.trim().length === 0) continue;
    const valueStart = match.index + match[0].length - value.length;
    const kind: SecretKind = always ? "aws-credential-param" : "signed-url-param";
    pushMatch(matches, valueStart, valueStart + value.length, kind);
  }

  // 5. Email addresses.
  for (const match of text.matchAll(
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  )) {
    pushMatch(matches, match.index, match.index + match[0].length, "email");
  }

  // 6. E.164 phone numbers. The leading `+` is required: without it the pattern
  //    matches ordinary long integers (ids, counts, timestamps) and the false
  //    positives would make the gate unusable.
  for (const match of text.matchAll(/\+[1-9]\d{7,14}\b/g)) {
    pushMatch(matches, match.index, match.index + match[0].length, "phone-e164");
  }

  return matches;
}

/** Drop matches fully contained in another; keep the widest span for overlaps. */
function resolveMatches(matches: Match[]): Match[] {
  const sorted = [...matches].sort((a, b) =>
    a.start === b.start ? b.end - a.end : a.start - b.start,
  );
  const kept: Match[] = [];
  for (const match of sorted) {
    const previous = kept[kept.length - 1];
    if (previous && match.start < previous.end) {
      // Overlap: extend the previous span if this one reaches further.
      if (match.end > previous.end) {
        kept[kept.length - 1] = { ...previous, end: match.end };
      }
      continue;
    }
    kept.push(match);
  }
  return kept;
}

function describe(secret: string, kind: SecretKind): string {
  const prefix = secret.slice(0, 4).replace(/[^\x20-\x7e]/g, "?");
  return `${kind} ${prefix}… (len=${secret.length}, sha256:${short(secret)})`;
}

/**
 * Recursively walk any JSON-ish value and report every credential or PII string
 * found in a VALUE, at any depth. Keys are walked too — a key can itself be an
 * email address in a map keyed by user.
 */
export function findSecrets(value: unknown, path = "$"): Finding[] {
  const findings: Finding[] = [];

  const visit = (node: unknown, at: string): void => {
    if (typeof node === "string") {
      for (const match of resolveMatches(scanString(node))) {
        findings.push({
          path: at,
          kind: match.kind,
          sample: describe(node.slice(match.start, match.end), match.kind),
        });
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${at}[${index}]`));
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        // The key itself can carry PII (e.g. `{"a@b.com": {...}}`).
        for (const match of resolveMatches(scanString(key))) {
          findings.push({
            path: `${at}.<key>`,
            kind: match.kind,
            sample: describe(key.slice(match.start, match.end), match.kind),
          });
        }
        visit(child, `${at}.${key}`);
      }
    }
  };

  visit(value, path);
  return findings;
}

/** Replace every detected span in one string with a stable placeholder. */
export function scrubString(text: string): string {
  const matches = resolveMatches(scanString(text));
  if (matches.length === 0) return text;
  let out = text;
  // Right-to-left so earlier offsets stay valid.
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index]!;
    const secret = out.slice(match.start, match.end);
    out = `${out.slice(0, match.start)}[scrubbed:${match.kind}:${short(secret)}]${out.slice(match.end)}`;
  }
  return out;
}

/**
 * Deep-copy `value` with every detected secret/PII span replaced by a stable
 * placeholder. Object KEYS are scrubbed too, so a map keyed by email address
 * does not survive into a committed cassette.
 *
 * Idempotent: `scrubValue(scrubValue(x))` equals `scrubValue(x)`.
 */
export function scrubValue<T>(value: T): T {
  const visit = (node: unknown): unknown => {
    if (typeof node === "string") return scrubString(node);
    if (Array.isArray(node)) return node.map(visit);
    if (node !== null && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        out[scrubString(key)] = visit(child);
      }
      return out;
    }
    return node;
  };
  return visit(value) as T;
}

/*
 * ---------------------------------------------------------------------------
 * Personal names: key-path based, write-only, deliberately NOT part of the gate
 * ---------------------------------------------------------------------------
 * A human name is not detectable by pattern — "Jane Doe" and "Front Camera" are
 * the same shape — so names are scrubbed by WHERE they sit, not by what they
 * look like. `findSecrets` intentionally does not report them: a detector that
 * cannot tell a person from a dataset title would either miss most names or
 * fail the build on every legitimate resource title, and a gate that cries wolf
 * gets switched off.
 *
 * The scope is narrow on purpose. A bare `name` is scrubbed ONLY inside a
 * person-shaped container (`owner`, `annotator`, `reviewer`, …), because
 * `dataset.name` and `project.name` are exactly the values the eval tasks ask
 * the agent to find. Unambiguously personal keys (`first_name`, `full_name`)
 * are scrubbed wherever they appear.
 */

/** Keys that are a person's name no matter where they appear. */
const PERSON_NAME_KEYS = new Set([
  "firstname",
  "lastname",
  "fullname",
  "givenname",
  "familyname",
  "surname",
  "displayname",
  "realname",
]);

/** Ambiguous keys — scrubbed only inside a person-shaped container. */
const AMBIGUOUS_NAME_KEYS = new Set(["name", "username", "handle", "codename", "label"]);

/** Container keys whose contents describe a person rather than a resource. */
const PERSON_CONTAINER_KEYS = new Set([
  "user",
  "owner",
  "annotator",
  "reviewer",
  "assignee",
  "assignedto",
  "createdby",
  "updatedby",
  "member",
  "members",
  "coworker",
  "contributor",
  "contributors",
  "author",
  "profile",
  "account",
  "operator",
  "submittedby",
  "acceptedby",
  "rejectedby",
]);

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** `reviewers` and `reviewer` are the same container; match both without listing both. */
function singularise(key: string): string {
  if (key.endsWith("ies") && key.length > 4) return `${key.slice(0, -3)}y`;
  if (key.endsWith("s") && !key.endsWith("ss") && key.length > 2) return key.slice(0, -1);
  return key;
}

function isPersonContainerKey(normalised: string): boolean {
  return (
    PERSON_CONTAINER_KEYS.has(normalised) ||
    PERSON_CONTAINER_KEYS.has(singularise(normalised))
  );
}

/** True when the value is already a placeholder, so re-scrubbing is a no-op. */
function isAlreadyScrubbed(text: string): boolean {
  return /^\[scrubbed:[a-z0-9-]+:[0-9a-f]{8}\]$/.test(text);
}

/**
 * Replace person-name values with a stable placeholder, based on key path.
 * Applied by the cassette writer only; `findSecrets` never reports these.
 */
export function scrubPersonNames<T>(value: T): T {
  const visit = (node: unknown, inPerson: boolean): unknown => {
    if (Array.isArray(node)) return node.map((item) => visit(item, inPerson));
    if (node === null || typeof node !== "object") return node;

    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const normalised = normaliseKey(key);
      const isPersonName =
        PERSON_NAME_KEYS.has(normalised) ||
        (inPerson && AMBIGUOUS_NAME_KEYS.has(normalised));

      if (isPersonName && typeof child === "string" && child.length > 0) {
        // Idempotence: an existing placeholder is left alone, otherwise a second
        // pass would hash the placeholder and churn the cassette on every run.
        out[key] = isAlreadyScrubbed(child)
          ? child
          : `[scrubbed:person-name:${short(child)}]`;
        continue;
      }
      // An array/object under a person container keeps the person context so
      // `members: [{ name: … }]` and `reviewers: [{ name: … }]` are covered.
      out[key] = visit(child, isPersonContainerKey(normalised) || (inPerson && Array.isArray(child)));
    }
    return out;
  };
  return visit(value, false) as T;
}

/** Full write-time scrub: value-scanned secrets/PII, then person names by key path. */
export function scrubForCassette<T>(value: T): T {
  return scrubPersonNames(scrubValue(value));
}

/** One-line renderer for logs and test failures. Never prints a raw secret. */
export function formatFindings(findings: readonly Finding[]): string {
  return findings.map((finding) => `  ${finding.path}: ${finding.sample}`).join("\n");
}
