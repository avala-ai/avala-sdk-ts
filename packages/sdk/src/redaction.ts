/**
 * Error-detail redaction for HTTP transports (pentest finding `s3-4`).
 *
 * The server commonly echoes parts of the request payload in 4xx/5xx
 * `detail` strings (validation errors are the canonical case:
 * "value 'sk_live_abc123' is not a valid <foo>"). When the SDK
 * re-raises that string into an exception, a secret in the request
 * flows directly into caller logs / Sentry / stdout.
 *
 * This helper applies a small, conservative set of regex redactions to
 * any string we surface to the caller. Pattern set is intentionally
 * narrow — false positives are worse than misses for caller debugging.
 *
 * Sibling of `sdks/python/avala/_redaction.py`. Pattern lists must
 * stay aligned across the two SDKs.
 */

const REDACTED_TOKEN = "[redacted]";

const REDACTION_PATTERNS: RegExp[] = [
  // Bearer / JWT-style triples (eyJ...).
  /eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g,
  // AWS access key IDs.
  /AKIA[0-9A-Z]{16}/g,
  /ASIA[0-9A-Z]{16}/g,
  // Codex devil's-advocate finding (PR #11449): AWS STS session tokens
  // have a fixed magic prefix (``FwoG`` for AWS, ``IQoJ`` for some
  // GovCloud regions) followed by a long base64 blob.
  /\b(?:FwoG|IQoJ)[A-Za-z0-9+/=]{16,}/g,
  // Google OAuth refresh tokens (``1//`` prefix).
  /\b1\/\/[A-Za-z0-9_\-]{20,}/g,
  // PEM private key blocks (RSA, EC, generic).
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |)PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |)PRIVATE KEY-----/g,
  // GCP service-account JSON: redact the private_key_id field's value.
  /"private_key_id"\s*:\s*"[^"]+"/gi,
  // Reviewer P1 follow-up on PR #11315: AWS *secret* access keys are
  // 40 chars of base64-ish [A-Za-z0-9/+=] — too generic to match
  // standalone. Redact context-aware: when the secret-key value is
  // echoed next to a known field name (aws_secret_access_key,
  // secretAccessKey, AWS_SECRET_ACCESS_KEY), strip the value.
  /\b(?:aws[_-]?secret[_-]?access[_-]?key|secretaccesskey)["']?\s*[:=]\s*["']?[A-Za-z0-9/+=]{20,}/gi,
  // Generic prefix-keyed secret tokens (Stripe / Resend / Supabase shapes).
  /\b(?:sk|pk|secret|key|token)_(?:live|test|prod)?_?[A-Za-z0-9]{16,}/g,
  // Avala API key shape: 40 hex chars.
  /\b[a-f0-9]{40}\b/g,
  // Authorization: Bearer <token>.
  /\bbearer\s+[A-Za-z0-9_.\-+/=]+/gi,
  // X-Avala-Api-Key header echoed in error payloads.
  /X-Avala-Api-Key["']?\s*[:=]\s*["']?[A-Za-z0-9_\-]+/gi,
  // AWS ARNs.
  /arn:aws[a-z0-9\-]*:[a-z0-9\-]*:[a-z0-9\-]*:[0-9]*:[A-Za-z0-9_\-./:*]+/g,
];

/** Redact secret-shaped fragments from a string. */
export function redactString(value: string): string {
  let out = value;
  for (const pattern of REDACTION_PATTERNS) {
    out = out.replace(pattern, REDACTED_TOKEN);
  }
  return out;
}

// Reviewer P1 (round 2) follow-up on PR #11315: structured bodies like
// {"aws_secret_access_key": "<40-char value>"} lose key context during
// recursive redaction — the standalone 40-char base64-ish value is
// intentionally too generic for the regex set, so the raw secret stays
// in the error body. Force-redact any scalar whose object key matches a
// known sensitive name. Keys are normalised to lowercase + non-
// alphanumerics stripped so aws_secret_access_key, AWS-Secret-Access-Key,
// awsSecretAccessKey, and aws.secret.access.key all match the same
// canonical name.
const SENSITIVE_KEY_NAMES: ReadonlySet<string> = new Set([
  "awssecretaccesskey",
  "secretaccesskey",
  "awsaccesskeyid",
  "accesskeyid",
  // Codex finding (PR #11449): aws_session_token normalises to
  // awssessiontoken, NOT sessiontoken. Add explicitly.
  "awssessiontoken",
  "apikey",
  "xavalaapikey",
  "authorization",
  "auth",
  "token",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "idtoken",
  "secret",
  "password",
  "passwd",
  "pwd",
  "credentials",
  "privatekey",
  // GCP service-account JSON sibling field.
  "privatekeyid",
  "clientsecret",
]);

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_NAMES.has(normaliseKey(key));
}

/**
 * Force-redact every scalar in ``value``. Used for values reached via
 * a sensitive key — by definition the secret, regardless of shape.
 * Recurses into containers so nested structure doesn't slip a secret
 * string through.
 *
 * Codex P2 follow-up on PR #11315: previously this passed numeric and
 * boolean scalars through. That misses numeric OTPs
 * (``{"token": 123456}``), short-numeric passwords, and any
 * string-typed secret that the JSON parser collapsed to ``number``.
 * Treat any non-``null``/``undefined`` scalar reached via a sensitive
 * key as the secret. ``null`` / ``undefined`` survive so callers can
 * distinguish "not set" from "[redacted]" in their own logs.
 */
function forceRedact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(forceRedact);
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = forceRedact(v);
    }
    return out;
  }
  if (value === null || value === undefined) {
    return value;
  }
  return REDACTED_TOKEN;
}

/**
 * Redact recursively. Strings get pattern-redacted; arrays and plain
 * objects recurse; everything else is returned unchanged.
 *
 * Object values are force-redacted when their key name matches a known
 * sensitive identifier (``aws_secret_access_key``, ``apiKey``,
 * ``Authorization``, ``password``, ...) regardless of the value's
 * content. This closes the structured-body gap where the standalone
 * 40-char base64-ish AWS secret was intentionally too generic for the
 * pattern set and would otherwise pass through unredacted.
 *
 * Non-throwing — redaction is best-effort defense-in-depth, not a
 * security control. Falling back to the original value on any
 * unexpected type is preferable to throwing inside an error path.
 */
export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? forceRedact(v) : redact(v);
    }
    return out;
  }
  return value;
}
