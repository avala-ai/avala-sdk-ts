/**
 * Output sanitization for MCP tool results (bug-bounty finding "AVL-MCP-02").
 *
 * MCP tool outputs are not normal API responses: they are commonly shown in
 * chat transcripts, logged by the client, retained in traces, and forwarded to
 * model providers / IDE integrations. So a credential-bearing field that reaches
 * a tool's text output can leak outside the intended API boundary (CWE-200/532).
 *
 * `safeStringify` recursively force-redacts any object value whose key name is a
 * known sensitive identifier (e.g. `deviceToken`, `device_token`, `apiKey`,
 * `secret`) before serializing. This is defense-in-depth: the Avala API already
 * omits `device_token` from fleet list/get responses, but the MCP server must
 * not blindly stringify whatever it receives.
 *
 * Key names are normalised (lowercased, non-alphanumerics stripped) so
 * snake_case / camelCase / kebab-case all match the same canonical name.
 */

export const REDACTED_OUTPUT_VALUE = "[redacted]";

const SENSITIVE_KEY_NAMES: ReadonlySet<string> = new Set([
  "devicetoken",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "sessiontoken",
  "apikey",
  "xavalaapikey",
  "secret",
  "clientsecret",
  "password",
  "passwd",
  "pwd",
  "credentials",
  "credential",
  "authorization",
  "privatekey",
  "privatekeyid",
  "awssecretaccesskey",
  "secretaccesskey",
  // AWS STS / access keys embedded in arbitrary config blobs (e.g. fleet
  // `metadata` or rule `actions`). `aws_session_token` normalises to
  // `awssessiontoken`, NOT `sessiontoken`, so it must be listed explicitly.
  "awssessiontoken",
  "awsaccesskeyid",
  "accesskeyid",
]);

const SENSITIVE_KEY_SUFFIXES: readonly (readonly string[])[] = [
  ["token"],
  ["jwt"],
  ["api", "key"],
  ["auth", "json", "content"],
  ["auth", "header"],
  ["authorization", "header"],
  ["secret"],
  ["password"],
  ["passwd"],
  ["pwd"],
  ["credentials"],
  ["credential"],
  ["authorization"],
  ["secret", "key"],
  ["private", "key"],
  ["private", "key", "id"],
  ["secret", "access", "key"],
  ["access", "key"],
  ["access", "key", "id"],
];

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function keyWords(key: string): string[] {
  return key
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function isSensitiveOutputKey(key: string): boolean {
  if (SENSITIVE_KEY_NAMES.has(normaliseKey(key))) return true;
  const words = keyWords(key);
  return SENSITIVE_KEY_SUFFIXES.some(
    (suffix) =>
      suffix.length <= words.length &&
      suffix.every(
        (word, index) => words[words.length - suffix.length + index] === word,
      ),
  );
}

/**
 * Return a deep copy of `value` with any value under a sensitive key replaced by
 * `[redacted]`. Non-throwing — best-effort defense-in-depth, never breaks a tool
 * call. `null` / `undefined` survive so callers can tell "unset" from redacted.
 */
export function sanitizeForOutput(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeForOutput);
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] =
        isSensitiveOutputKey(key) && val !== null && val !== undefined
          ? REDACTED_OUTPUT_VALUE
          : sanitizeForOutput(val);
    }
    return out;
  }
  return value;
}

/** `JSON.stringify(value, null, 2)` with sensitive fields redacted first. */
export function safeStringify(value: unknown): string {
  return JSON.stringify(sanitizeForOutput(value), null, 2);
}
