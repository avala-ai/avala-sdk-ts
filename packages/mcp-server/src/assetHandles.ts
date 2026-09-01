import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  acceptedContent,
  inputRequired,
  inputResponse,
  type McpServer,
} from "@modelcontextprotocol/server";
import type { GetClient } from "./client.js";
import { renderCatalogPath } from "./catalog.js";
import {
  isSensitiveOutputKey,
  REDACTED_OUTPUT_VALUE,
} from "./redact.js";
import { findSecrets } from "./secrets.js";
import type { CredentialToolGrant } from "./visibility.js";
import { z } from "zod";

const HANDLE_PREFIX = "ah_";
const HANDLE_PATTERN = /^ah_[A-Za-z0-9_-]+$/;
const CONFIRMATION_PREFIX = "ac_";
const CONFIRMATION_PATTERN = /^ac_[A-Za-z0-9_-]+$/;
const HANDLE_VERSION = 1;
const HANDLE_TTL_MS = 15 * 60 * 1000;
const CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const HANDLE_MAX_LENGTH = 4096;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const HANDLE_AAD = Buffer.from("avala-mcp:asset-handle:v1", "utf8");
const CONFIRMATION_AAD = Buffer.from(
  "avala-mcp:asset-confirmation:v1",
  "utf8",
);
const PROCESS_KEY_MATERIAL = randomBytes(32);

const locatorPathSchema = z
  .array(z.union([z.string().min(1).max(160), z.number().int().nonnegative()]))
  .max(24);
const resourceText = z.string().min(1).max(512);

const assetLocatorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("export_download"),
    uid: resourceText,
    identity: resourceText,
  }),
  z.object({
    kind: z.literal("slice_featured_asset"),
    owner: resourceText,
    slug: resourceText,
    identity: resourceText,
  }),
  z.object({
    kind: z.literal("dataset_asset"),
    uid: resourceText,
    identity: resourceText,
    path: locatorPathSchema,
  }),
  z.object({
    kind: z.literal("dataset_featured_asset"),
    uid: resourceText,
    identity: resourceText,
  }),
  z.object({
    kind: z.literal("organization_asset"),
    slug: resourceText,
    identity: resourceText,
    path: locatorPathSchema,
  }),
  z.object({
    kind: z.literal("sequence_asset"),
    owner: resourceText,
    slug: resourceText,
    sequenceUid: resourceText,
    identity: resourceText,
    path: locatorPathSchema,
  }),
  z.object({
    kind: z.literal("sequence_frame_asset"),
    owner: resourceText,
    slug: resourceText,
    sequenceUid: resourceText,
    frameUid: resourceText,
    identity: resourceText,
    path: locatorPathSchema,
  }),
  z.object({
    kind: z.literal("sequence_featured_asset"),
    owner: resourceText,
    slug: resourceText,
    sequenceUid: resourceText,
    limit: z.number().int().positive(),
    cursor: z.string().min(1).optional(),
    identity: resourceText,
  }),
  z.object({
    kind: z.literal("frame_asset"),
    owner: resourceText,
    slug: resourceText,
    sequenceUid: resourceText,
    frameUid: resourceText,
    identity: resourceText,
    path: locatorPathSchema,
  }),
  z.object({
    kind: z.literal("capture_asset"),
    resultUid: resourceText,
    identity: resourceText,
    path: locatorPathSchema,
  }),
]);

export type AssetLocator = z.infer<typeof assetLocatorSchema>;

const envelopeSchema = z.object({
  version: z.literal(HANDLE_VERSION),
  expiresAtMs: z.number().int().positive(),
  locator: assetLocatorSchema,
});

const confirmationEnvelopeSchema = z.object({
  version: z.literal(HANDLE_VERSION),
  expiresAtMs: z.number().int().positive(),
  handleDigest: z.string().length(43),
});

const confirmationInputSchema = z
  .object({
    confirm: z
      .boolean()
      .describe("Confirm release of the temporary bearer URL"),
  });

const CONFIRMATION_REQUESTED_SCHEMA = {
  type: "object" as const,
  properties: {
    confirm: {
      type: "boolean" as const,
      title: "Release temporary asset URL",
    },
  },
  required: ["confirm"],
};

const CONFIRMATION_INPUT_KEY = "confirmAssetUrlRelease";
const CONFIRMATION_MESSAGE =
  "Release this temporary asset URL? The URL is a short-lived bearer capability and may enter the MCP client's transcript or logs.";

export const assetReferenceSchema = z
  .object({
    handle: z
      .string()
      .regex(HANDLE_PATTERN)
      .max(HANDLE_MAX_LENGTH)
      .describe(
        "Opaque, short-lived asset handle. Resolve it explicitly with resolve_asset_handle after confirmation.",
      ),
  })
  .strip();

export type AssetReference = z.infer<typeof assetReferenceSchema>;

export interface AssetHandleService {
  issue(locator: AssetLocator): AssetReference;
  open(handle: string): AssetLocator;
  issueConfirmation(handle: string): string;
  verifyConfirmation(state: string, handle: string): void;
}

export function assetReferenceFor(
  value: unknown,
  locator: AssetLocator,
  handles: AssetHandleService,
): AssetReference | null {
  if (value === null || value === undefined || value === "") return null;
  validatedAssetUrl(value);
  return handles.issue(locator);
}

export function identityBoundAssetReferenceFor(
  value: unknown,
  locatorForIdentity: (identity: string) => AssetLocator,
  handles: AssetHandleService,
): AssetReference | null {
  if (value === null || value === undefined || value === "") return null;
  return handles.issue(locatorForIdentity(assetIdentityForUrl(value)));
}

function assetFieldName(key: string): string {
  if (/urls$/i.test(key)) return key.replace(/urls$/i, "Assets");
  if (/url$/i.test(key)) return key.replace(/url$/i, "Asset");
  return `${key}Asset`;
}

function isSensitiveAssetField(key: string): boolean {
  if (isSensitiveOutputKey(key)) return true;
  const withoutUrlSuffix = key.replace(/(?:urls?|uris?)$/i, "");
  return withoutUrlSuffix !== key && isSensitiveOutputKey(withoutUrlSuffix);
}

function containsCredentialUrl(value: unknown): boolean {
  if (isCredentialBearingUrl(value)) return true;
  if (Array.isArray(value)) return value.some(containsCredentialUrl);
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value as Record<string, unknown>).some(containsCredentialUrl)
  );
}

/**
 * Replace credential-bearing URL values at any depth with opaque references.
 * Ordinary public URLs remain ordinary data. When a direct object field is
 * replaced, its name changes from `*Url`/`*Urls` to `*Asset`/`*Assets` (or
 * gains an `Asset` suffix) so consumers never mistake a handle for a URL.
 */
export function assetizeCredentialUrls(
  value: unknown,
  locatorForPath: (
    path: readonly (string | number)[],
    url: string,
  ) => AssetLocator,
  handles: AssetHandleService,
): unknown {
  const visit = (
    node: unknown,
    path: readonly (string | number)[],
  ): { value: unknown; directlyAssetized: boolean } => {
    if (isCredentialBearingUrl(node)) {
      return {
        value: handles.issue(locatorForPath(path, node)),
        directlyAssetized: true,
      };
    }
    if (Array.isArray(node)) {
      const children = node.map((child, index) =>
        visit(child, [...path, index]),
      );
      return {
        value: children.map((child) => child.value),
        directlyAssetized: children.some((child) => child.directlyAssetized),
      };
    }
    if (typeof node !== "object" || node === null) {
      return { value: node, directlyAssetized: false };
    }

    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(
      node as Record<string, unknown>,
    )) {
      // Apply the key-name sanitizer before any asset rewrite, including for
      // hand-written tools that do not pass through the catalog parser. URL/URI
      // suffixes are additionally treated as sensitive only when their value
      // contains a credential-bearing URL (for example `tokenUrl`); public
      // endpoint URLs remain ordinary data.
      if (
        child !== null &&
        child !== undefined &&
        (isSensitiveOutputKey(key) ||
          (isSensitiveAssetField(key) && containsCredentialUrl(child)))
      ) {
        output[key] = REDACTED_OUTPUT_VALUE;
        continue;
      }
      const transformed = visit(child, [...path, key]);
      output[
        transformed.directlyAssetized &&
        (typeof child === "string" || Array.isArray(child))
          ? assetFieldName(key)
          : key
      ] = transformed.value;
    }
    return { value: output, directlyAssetized: false };
  };

  return visit(value, []).value;
}

function deriveKey(
  keyMaterial: string | Uint8Array,
  purpose: Uint8Array,
): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      keyMaterial,
      Buffer.from("avala-mcp", "utf8"),
      purpose,
      32,
    ),
  );
}

function invalidHandle(): Error {
  // Keep every parse/decrypt/expiry failure indistinguishable so the decoder
  // does not become an oracle for the encrypted locator.
  return new Error("Invalid or expired asset handle.");
}

function invalidConfirmation(): Error {
  return new Error("Invalid or expired asset confirmation.");
}

function handleDigest(handle: string): Buffer {
  return createHash("sha256").update(handle, "utf8").digest();
}

export function createAssetHandleService(
  keyMaterial: string | Uint8Array = PROCESS_KEY_MATERIAL,
  now: () => number = Date.now,
): AssetHandleService {
  const key = deriveKey(keyMaterial, HANDLE_AAD);
  const confirmationKey = deriveKey(keyMaterial, CONFIRMATION_AAD);

  return {
    issue(locator): AssetReference {
      const envelope = envelopeSchema.parse({
        version: HANDLE_VERSION,
        expiresAtMs: now() + HANDLE_TTL_MS,
        locator,
      });
      const plaintext = Buffer.from(JSON.stringify(envelope), "utf8");
      const iv = randomBytes(AES_GCM_IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(HANDLE_AAD);
      const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      const handle = `${HANDLE_PREFIX}${Buffer.concat([iv, tag, ciphertext]).toString("base64url")}`;
      if (handle.length > HANDLE_MAX_LENGTH) {
        throw new Error("Asset locator is too large.");
      }
      return { handle };
    },

    open(handle): AssetLocator {
      try {
        if (!HANDLE_PATTERN.test(handle) || handle.length > HANDLE_MAX_LENGTH) {
          throw invalidHandle();
        }
        const packed = Buffer.from(
          handle.slice(HANDLE_PREFIX.length),
          "base64url",
        );
        if (packed.length <= AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES) {
          throw invalidHandle();
        }
        const iv = packed.subarray(0, AES_GCM_IV_BYTES);
        const tag = packed.subarray(
          AES_GCM_IV_BYTES,
          AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES,
        );
        const ciphertext = packed.subarray(
          AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES,
        );
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(HANDLE_AAD);
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]).toString("utf8");
        const envelope = envelopeSchema.parse(JSON.parse(plaintext));
        if (envelope.expiresAtMs <= now()) throw invalidHandle();
        return envelope.locator;
      } catch {
        throw invalidHandle();
      }
    },

    issueConfirmation(handle): string {
      try {
        if (!HANDLE_PATTERN.test(handle) || handle.length > HANDLE_MAX_LENGTH) {
          throw invalidConfirmation();
        }
        const envelope = confirmationEnvelopeSchema.parse({
          version: HANDLE_VERSION,
          expiresAtMs: now() + CONFIRMATION_TTL_MS,
          handleDigest: handleDigest(handle).toString("base64url"),
        });
        const iv = randomBytes(AES_GCM_IV_BYTES);
        const cipher = createCipheriv("aes-256-gcm", confirmationKey, iv);
        cipher.setAAD(CONFIRMATION_AAD);
        const ciphertext = Buffer.concat([
          cipher.update(JSON.stringify(envelope), "utf8"),
          cipher.final(),
        ]);
        return `${CONFIRMATION_PREFIX}${Buffer.concat([
          iv,
          cipher.getAuthTag(),
          ciphertext,
        ]).toString("base64url")}`;
      } catch {
        throw invalidConfirmation();
      }
    },

    verifyConfirmation(state: string, handle: string): void {
      try {
        if (
          !CONFIRMATION_PATTERN.test(state) ||
          state.length > HANDLE_MAX_LENGTH
        ) {
          throw invalidConfirmation();
        }
        const packed = Buffer.from(
          state.slice(CONFIRMATION_PREFIX.length),
          "base64url",
        );
        if (packed.length <= AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES) {
          throw invalidConfirmation();
        }
        const iv = packed.subarray(0, AES_GCM_IV_BYTES);
        const tag = packed.subarray(
          AES_GCM_IV_BYTES,
          AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES,
        );
        const decipher = createDecipheriv(
          "aes-256-gcm",
          confirmationKey,
          iv,
        );
        decipher.setAAD(CONFIRMATION_AAD);
        decipher.setAuthTag(tag);
        const envelope = confirmationEnvelopeSchema.parse(
          JSON.parse(
            Buffer.concat([
              decipher.update(
                packed.subarray(AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES),
              ),
              decipher.final(),
            ]).toString("utf8"),
          ),
        );
        const expected = handleDigest(handle);
        const received = Buffer.from(envelope.handleDigest, "base64url");
        if (
          envelope.expiresAtMs <= now() ||
          received.length !== expected.length ||
          !timingSafeEqual(received, expected)
        ) {
          throw invalidConfirmation();
        }
      } catch {
        throw invalidConfirmation();
      }
    },
  };
}

function valueAtPath(
  value: unknown,
  path: readonly (string | number)[],
): unknown {
  let current = value;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment >= current.length)
        return undefined;
      current = current[segment];
      continue;
    }
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current) ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Read the stable frame identifier from either a raw sequence frame or the SDK's canonical frame view. */
export function frameUidForValue(value: unknown): string | undefined {
  const rawUid = valueAtPath(value, ["raw", "uid"]);
  if (typeof rawUid === "string") return rawUid;
  const directUid = valueAtPath(value, ["uid"]);
  return typeof directUid === "string" ? directUid : undefined;
}

const AWS_SIGNING_QUERY_PARAMS: ReadonlySet<string> = new Set([
  "awsaccesskeyid",
  "expires",
  "signature",
  "x-amz-algorithm",
  "x-amz-credential",
  "x-amz-date",
  "x-amz-expires",
  "x-amz-security-token",
  "x-amz-signature",
  "x-amz-signedheaders",
]);
const GCS_SIGNING_QUERY_PARAMS: ReadonlySet<string> = new Set([
  "expires",
  "googleaccessid",
  "signature",
  "x-goog-algorithm",
  "x-goog-credential",
  "x-goog-date",
  "x-goog-expires",
  "x-goog-signature",
  "x-goog-signedheaders",
]);
const CLOUDFRONT_SIGNING_QUERY_PARAMS: ReadonlySet<string> = new Set([
  "expires",
  "key-pair-id",
  "policy",
  "signature",
]);
const AZURE_SAS_QUERY_PARAMS: ReadonlySet<string> = new Set([
  "se",
  "ses",
  "si",
  "sig",
  "sip",
  "ske",
  "skoid",
  "sks",
  "skt",
  "sktid",
  "skv",
  "sp",
  "spr",
  "sr",
  "srt",
  "ss",
  "st",
  "sv",
]);

function rotatingSigningParameterNames(
  searchParams: URLSearchParams,
): ReadonlySet<string> {
  const names = new Set(
    [...searchParams.keys()].map((name) => name.toLowerCase()),
  );
  const ignored = new Set<string>();
  const add = (values: ReadonlySet<string>): void => {
    for (const value of values) ignored.add(value);
  };
  if (
    names.has("awsaccesskeyid") ||
    names.has("x-amz-credential") ||
    names.has("x-amz-signature")
  ) {
    add(AWS_SIGNING_QUERY_PARAMS);
  }
  if (
    names.has("googleaccessid") ||
    names.has("x-goog-credential") ||
    names.has("x-goog-signature")
  ) {
    add(GCS_SIGNING_QUERY_PARAMS);
  }
  if (
    names.has("signature") &&
    (names.has("key-pair-id") || names.has("policy"))
  ) {
    add(CLOUDFRONT_SIGNING_QUERY_PARAMS);
  }
  if (
    names.has("sig") &&
    (names.has("sv") || names.has("se")) &&
    (names.has("sr") || names.has("ss") || names.has("srt"))
  ) {
    add(AZURE_SAS_QUERY_PARAMS);
  }
  return ignored;
}

function validatedAssetUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 16_384) {
    throw new Error("The asset is no longer available.");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("The asset is no longer available.");
  }
  const localFile = parsed.protocol === "file:";
  const localHttp =
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (
    (!localFile && !localHttp && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error("The asset is no longer available.");
  }
  return value;
}

/**
 * Stable, credential-free identity for a refreshed provider URL.
 *
 * Known provider signing parameters rotate on every read and are excluded.
 * Every other query component and the fragment remain part of the identity so
 * query-selected assets sharing one path cannot be confused. Only the digest,
 * never the URL or its bearer parameters, is retained in the locator.
 */
export function assetIdentityForUrl(value: unknown): string {
  const parsed = new URL(validatedAssetUrl(value));
  const ignored = rotatingSigningParameterNames(parsed.searchParams);
  const stableQuery = [...parsed.searchParams.entries()]
    .filter(([key]) => !ignored.has(key.toLowerCase()))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
      if (leftValue === rightValue) return 0;
      return leftValue < rightValue ? -1 : 1;
    });
  return createHash("sha256")
    .update(
      JSON.stringify({
        origin: parsed.origin,
        pathname: parsed.pathname,
        query: stableQuery,
        fragment: parsed.hash,
      }),
      "utf8",
    )
    .digest("base64url");
}

function assetByIdentity(value: unknown, identity: string): unknown {
  if (!Array.isArray(value)) return undefined;
  for (const candidate of value) {
    try {
      if (assetIdentityForUrl(candidate) === identity) return candidate;
    } catch {
      // A malformed sibling must not prevent a valid current asset from being
      // found. If no candidate matches, resolution still fails closed below.
    }
  }
  return undefined;
}

function assetByIdentityDeep(value: unknown, identity: string): unknown {
  if (typeof value === "string") {
    try {
      return assetIdentityForUrl(value) === identity ? value : undefined;
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const match = assetByIdentityDeep(candidate, identity);
      if (match !== undefined) return match;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  for (const candidate of Object.values(value as Record<string, unknown>)) {
    const match = assetByIdentityDeep(candidate, identity);
    if (match !== undefined) return match;
  }
  return undefined;
}

function assetAtIdentity(
  value: unknown,
  path: readonly (string | number)[],
  identity: string,
): unknown {
  const atPath = valueAtPath(value, path);
  try {
    if (assetIdentityForUrl(atPath) === identity) return atPath;
  } catch {
    // The selected asset may have shifted within a nested array. Search only
    // inside its already UID-bound frame before failing closed.
  }
  return assetByIdentityDeep(value, identity);
}

function assetAtPathWithIdentity(
  value: unknown,
  path: readonly (string | number)[],
  identity: string,
): unknown {
  const candidate = valueAtPath(value, path);
  try {
    return assetIdentityForUrl(candidate) === identity ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function awsExpiry(url: URL): Date | null {
  const date = url.searchParams.get("X-Amz-Date");
  const rawSeconds = url.searchParams.get("X-Amz-Expires");
  if (!date || rawSeconds === null || rawSeconds === "") return null;
  const seconds = Number(rawSeconds);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(date);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const issuedAt = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  return new Date(issuedAt + seconds * 1000);
}

function googleExpiry(url: URL): Date | null {
  const date = url.searchParams.get("X-Goog-Date");
  const rawSeconds = url.searchParams.get("X-Goog-Expires");
  if (!date || rawSeconds === null || rawSeconds === "") return null;
  const seconds = Number(rawSeconds);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(date);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const issuedAt = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  return new Date(issuedAt + seconds * 1000);
}

function legacyExpiry(url: URL): Date | null {
  const raw = url.searchParams.get("Expires");
  if (raw === null || raw === "") return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0
    ? new Date(seconds * 1000)
    : null;
}

function expiryFromUrl(value: string): string | null {
  const url = new URL(value);
  const expiry = awsExpiry(url) ?? googleExpiry(url) ?? legacyExpiry(url);
  return expiry && !Number.isNaN(expiry.getTime())
    ? expiry.toISOString()
    : null;
}

async function resolveLocator(
  getClient: GetClient,
  locator: AssetLocator,
): Promise<string> {
  const avala = getClient("resolve_asset_handle");
  let value: unknown;
  switch (locator.kind) {
    case "export_download":
      value = await avala.transport.requestSingle<Record<string, unknown>>(
        renderCatalogPath("/exports/{uid}/", { uid: locator.uid }),
      );
      value = assetAtPathWithIdentity(
        value,
        ["downloadUrl"],
        locator.identity,
      );
      break;
    case "slice_featured_asset":
      value = await avala.transport.requestSingle<Record<string, unknown>>(
        renderCatalogPath("/slices/{owner}/{slug}/", locator),
      );
      value = assetByIdentity(
        valueAtPath(value, ["featuredSliceItemUrls"]),
        locator.identity,
      );
      break;
    case "dataset_asset":
      value = await avala.transport.requestSingle<Record<string, unknown>>(
        renderCatalogPath("/datasets/{uid}/", locator),
      );
      value = assetAtPathWithIdentity(
        value,
        locator.path,
        locator.identity,
      );
      break;
    case "dataset_featured_asset":
      value = await avala.transport.requestSingle<Record<string, unknown>>(
        renderCatalogPath("/datasets/{uid}/", locator),
      );
      value = assetByIdentity(
        valueAtPath(value, ["featuredItemsUrl"]),
        locator.identity,
      );
      break;
    case "organization_asset":
      value = await avala.transport.requestSingle<Record<string, unknown>>(
        renderCatalogPath("/organizations/{slug}/", locator),
      );
      value = assetAtPathWithIdentity(
        value,
        locator.path,
        locator.identity,
      );
      break;
    case "sequence_asset":
      value = await avala.transport.requestSingle<Record<string, unknown>>(
        renderCatalogPath(
          "/datasets/{owner}/{slug}/sequences/{sequenceUid}/",
          locator,
        ),
      );
      value = assetAtPathWithIdentity(
        value,
        locator.path,
        locator.identity,
      );
      break;
    case "sequence_frame_asset": {
      const sequence = await avala.transport.requestSingle<
        Record<string, unknown>
      >(
        renderCatalogPath(
          "/datasets/{owner}/{slug}/sequences/{sequenceUid}/",
          locator,
        ),
      );
      const frames = valueAtPath(sequence, ["frames"]);
      const frame = Array.isArray(frames)
        ? frames.find(
            (candidate) => frameUidForValue(candidate) === locator.frameUid,
          )
        : undefined;
      value = assetAtIdentity(frame, locator.path, locator.identity);
      break;
    }
    case "sequence_featured_asset": {
      // The featured image is deliberately a list-view concern in Django and
      // is absent from the sequence-detail serializer. Re-read the same cursor
      // page that issued the handle, then bind the result to the encrypted UID
      // rather than trusting its old array position.
      const page = await avala.transport.requestPage<Record<string, unknown>>(
        renderCatalogPath("/datasets/{owner}/{slug}/sequences/", locator),
        {
          limit: String(locator.limit),
          ...(locator.cursor === undefined ? {} : { cursor: locator.cursor }),
        },
      );
      const sequence = page.items.find(
        (item) => item.uid === locator.sequenceUid,
      );
      value = assetAtPathWithIdentity(
        sequence,
        ["featuredImage"],
        locator.identity,
      );
      break;
    }
    case "frame_asset": {
      const sequence = await avala.transport.requestSingle<
        Record<string, unknown>
      >(
        renderCatalogPath(
          "/datasets/{owner}/{slug}/sequences/{sequenceUid}/",
          locator,
        ),
      );
      const frames = valueAtPath(sequence, ["frames"]);
      const currentIndex = Array.isArray(frames)
        ? frames.findIndex(
            (candidate) => frameUidForValue(candidate) === locator.frameUid,
          )
        : -1;
      if (currentIndex < 0) break;
      const frame = await avala.datasets.getFrame(
        locator.owner,
        locator.slug,
        locator.sequenceUid,
        currentIndex,
      );
      // getFrame performs its own sequence read. Re-check the UID so a frame
      // deletion between the two reads can only fail closed, never drift.
      value =
        frameUidForValue(frame) === locator.frameUid
          ? assetAtIdentity(frame, locator.path, locator.identity)
          : undefined;
      break;
    }
    case "capture_asset":
      value = await avala.transport.requestSingle<Record<string, unknown>>(
        renderCatalogPath("/results/{resultUid}/capture-submission/", locator),
      );
      value = assetAtPathWithIdentity(
        value,
        locator.path,
        locator.identity,
      );
      break;
  }
  return validatedAssetUrl(value);
}

export function isCredentialBearingUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  } catch {
    return false;
  }
  return findSecrets(value).some(
    (finding) =>
      finding.kind === "aws-access-key-id" ||
      finding.kind === "aws-credential-param" ||
      finding.kind === "signed-url-param",
  );
}

function locatorRequiredScope(locator: AssetLocator): string {
  switch (locator.kind) {
    case "export_download":
      return "exports.read";
    case "organization_asset":
      return "organizations.read";
    case "slice_featured_asset":
      return "slices.read";
    case "dataset_asset":
    case "dataset_featured_asset":
    case "sequence_asset":
    case "sequence_frame_asset":
    case "sequence_featured_asset":
    case "frame_asset":
    case "capture_asset":
      return "datasets.read";
  }
}

function validDiscoveredScopes(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (scope) =>
        typeof scope === "string" &&
        scope !== "" &&
        scope === scope.trim(),
    )
  );
}

async function requireLocatorScope(
  getClient: GetClient,
  locator: AssetLocator,
  credentialGrant: CredentialToolGrant | undefined,
): Promise<void> {
  const requiredScope = locatorRequiredScope(locator);
  if (credentialGrant) {
    if (credentialGrant.scopes.has(requiredScope)) return;
  } else {
    try {
      const permissions = await getClient(
        "resolve_asset_handle_permissions",
      ).permissions.get();
      if (
        validDiscoveredScopes(permissions.scopes) &&
        permissions.scopes.includes(requiredScope)
      ) {
        return;
      }
    } catch {
      // Permission discovery is itself authorization evidence. Any transport,
      // schema, or credential failure must fail closed at the release boundary.
    }
  }
  throw new Error("Asset handle is not authorized for the current credential.");
}

export function registerAssetResolverTool(
  server: McpServer,
  getClient: GetClient,
  handles: AssetHandleService,
  credentialGrant?: CredentialToolGrant,
): void {
  const outputSchema = z
    .object({
      url: z.string().url(),
      expiresAt: z.string().datetime().nullable(),
    })
    .strip();

  server.registerTool(
    "resolve_asset_handle",
    {
      title: "Resolve asset handle",
      description:
        "Exchange one opaque asset handle for a fresh asset URL after server-enforced MCP elicitation confirms release. Unsupported, declined, forged, or cross-handle replayed confirmation fails closed. The original REST resource is fetched again with the current credential, so revoked access fails at resolve time; expiresAt reports provider-declared expiry when available.",
      inputSchema: z.object({
        handle: z
          .string()
          .regex(HANDLE_PATTERN)
          .max(HANDLE_MAX_LENGTH)
          .describe("Opaque handle returned by another Avala MCP read tool"),
      }),
      outputSchema,
      annotations: {
        title: "Resolve asset handle",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: {
        "avala.ai/required-any-scopes": [
          "datasets.read",
          "organizations.read",
          "slices.read",
          "exports.read",
        ],
        "avala.ai/toolsets": [
          "datasets",
          "sequences",
          "organizations",
          "slices",
          "exports",
        ],
        "avala.ai/requires-confirmation": true,
      },
    },
    async ({ handle }, context) => {
      // Reject a bad/expired handle before asking the user to approve a
      // capability that cannot be released. The locator's own domain scope is
      // checked independently of the resolver's any-scope discovery metadata.
      const initialLocator = handles.open(handle);
      await requireLocatorScope(getClient, initialLocator, credentialGrant);

      if (context.mcpReq.envelope !== undefined) {
        // 2026-07-28 protocol: confirmation is a multi-round-trip request.
        // The encrypted requestState proves this server issued the challenge
        // for this exact handle; an injected inputResponses object alone is
        // insufficient to cross the release boundary.
        const response = inputResponse(
          context.mcpReq.inputResponses,
          CONFIRMATION_INPUT_KEY,
        );
        const confirmed = acceptedContent(
          context.mcpReq.inputResponses,
          CONFIRMATION_INPUT_KEY,
          confirmationInputSchema,
        );
        if (confirmed?.confirm !== true) {
          if (response.kind === "elicit" && response.action !== "accept") {
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: "Asset URL release was not confirmed.",
                },
              ],
            };
          }
          if (response.kind === "elicit" && response.action === "accept") {
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: "Asset URL confirmation was invalid.",
                },
              ],
            };
          }
          return inputRequired({
            inputRequests: {
              [CONFIRMATION_INPUT_KEY]: inputRequired.elicit({
                message: CONFIRMATION_MESSAGE,
                requestedSchema: CONFIRMATION_REQUESTED_SCHEMA,
              }),
            },
            requestState: handles.issueConfirmation(handle),
          });
        }
        const requestState = context.mcpReq.requestState<string>();
        if (typeof requestState !== "string") {
          throw invalidConfirmation();
        }
        handles.verifyConfirmation(requestState, handle);
      } else {
        // 2025 protocol: use the bidirectional elicitation request. Stateless
        // hosted legacy clients cannot fulfil it and therefore fail closed;
        // stdio clients with elicitation support can confirm in-band.
        const elicited = await context.mcpReq.elicitInput({
          mode: "form",
          message: CONFIRMATION_MESSAGE,
          requestedSchema: CONFIRMATION_REQUESTED_SCHEMA,
        });
        const confirmed = confirmationInputSchema.safeParse(elicited.content);
        if (
          elicited.action !== "accept" ||
          !confirmed.success ||
          confirmed.data.confirm !== true
        ) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "Asset URL release was not confirmed.",
              },
            ],
          };
        }
      }

      const locator = handles.open(handle);
      // Re-check immediately before the upstream read. This matters for stdio
      // elicitation, where the credential can be revoked while the client is
      // waiting for user confirmation. Hosted modern follow-up requests also
      // receive a freshly discovered grant when their server is constructed.
      await requireLocatorScope(getClient, locator, credentialGrant);
      const url = await resolveLocator(getClient, locator);
      const structuredContent = outputSchema.parse({
        url,
        expiresAt: expiryFromUrl(url),
      });
      return {
        structuredContent,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(structuredContent, null, 2),
          },
        ],
      };
    },
  );
}
