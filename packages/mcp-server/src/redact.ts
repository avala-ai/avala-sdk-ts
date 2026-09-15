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
  if (typeof value === "string") return redactSerializedFields(value);
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

/**
 * Redact JSON fields even after a handler serializes its response, including
 * JSON embedded in prose or in another JSON string. Replace only value spans:
 * parsing and reserializing an entire response would round large integers,
 * collapse duplicate keys, and change unrelated formatting.
 */
function isJsonValue(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function redactSerializedFields(text: string): string {
  if (isJsonValue(text)) return redactJsonFields(text);
  // Prose is not a JSON token stream: an unmatched quote must not consume
  // the opening quote of a field in a later embedded object.
  const openings = /[\[{]/g;
  // Malformed prose can contain arbitrarily many unmatched openings. Bound
  // character visits plus candidate-validation lengths to a constant multiple
  // of input size. Exhaustion must discard this string, never emit its secrets.
  let budget = 4 * text.length;
  let output = "";
  let cursor = 0;
  for (let opening = openings.exec(text); opening; opening = openings.exec(text)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let offset = opening.index; offset < text.length; offset += 1) {
      if (--budget < 0) return REDACTED_OUTPUT_VALUE;
      const character = text[offset];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === "{" || character === "[") depth += 1;
      if (character === "}" || character === "]") depth -= 1;
      if (depth !== 0) continue;
      const end = offset + 1;
      budget -= end - opening.index;
      if (budget < 0) return REDACTED_OUTPUT_VALUE;
      const candidate = text.slice(opening.index, end);
      // Validation only; retain the original numeric spelling and keys.
      if (isJsonValue(candidate)) {
        output += text.slice(cursor, opening.index) + redactJsonFields(candidate);
        cursor = end;
        openings.lastIndex = end;
      }
      // Otherwise try later openings, including inside a malformed candidate.
      break;
    }
  }
  return output + text.slice(cursor);
}

/** Only tokenize a complete, validated JSON value, never surrounding prose. */
function redactJsonFields(text: string): string {
  const tokens = [...text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g)];
  let output = "";
  let cursor = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token[0].startsWith('"')) continue;
    let decoded: string;
    try {
      decoded = JSON.parse(token[0]) as string;
    } catch {
      continue;
    }
    const colon = tokens[index + 1];
    const value = tokens[index + 2];
    if (
      isSensitiveOutputKey(decoded) && colon?.[0] === ":" && value &&
      /^\s*$/.test(text.slice(token.index + token[0].length, colon.index)) &&
      /^\s*$/.test(text.slice(colon.index + 1, value.index))
    ) {
      let endIndex = index + 2;
      if (value[0] === "{" || value[0] === "[") {
        let depth = 1;
        while (depth > 0 && endIndex + 1 < tokens.length) {
          endIndex += 1;
          const current = tokens[endIndex]![0];
          if (current === "{" || current === "[") depth += 1;
          if (current === "}" || current === "]") depth -= 1;
        }
      }
      const last = tokens[endIndex]!;
      const end = last.index + last[0].length;
      try {
        // Validate the span, but never use the parsed value for serialization.
        const parsed: unknown = JSON.parse(text.slice(value.index, end));
        if (parsed !== null) {
          output += text.slice(cursor, value.index) + JSON.stringify(REDACTED_OUTPUT_VALUE);
          cursor = end;
          index = endIndex;
          continue;
        }
      } catch {
        // A quoted word in ordinary prose need not introduce a JSON field.
      }
    }
    const nested = redactSerializedFields(decoded);
    if (nested !== decoded) {
      output += text.slice(cursor, token.index) + JSON.stringify(nested);
      cursor = token.index + token[0].length;
    }
  }
  return output + text.slice(cursor);
}

/** `JSON.stringify(value, null, 2)` with sensitive fields redacted first. */
export function safeStringify(value: unknown): string {
  return JSON.stringify(sanitizeForOutput(value), null, 2);
}
