import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  acceptedContent,
  inputRequired,
  inputResponse,
  type CallToolResult,
  type McpServer,
  type ServerContext,
  type ToolCallback,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GetClient } from "./client.js";
import { renderCatalogPath } from "./catalog.js";
import { sanitizeForOutput } from "./redact.js";

type AnyZodObject = z.ZodObject;

const STATE_PREFIX = "mc_";
const STATE_PATTERN = /^mc_[A-Za-z0-9_-]+$/;
const STATE_VERSION = 1;
const STATE_TTL_MS = 5 * 60 * 1000;
const STATE_MAX_LENGTH = 4096;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const STATE_AAD = Buffer.from("avala-mcp:mutation-confirmation:v1", "utf8");
const PROCESS_KEY_MATERIAL = randomBytes(32);
const DIGEST_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const confirmationEnvelopeSchema = z
  .object({
    version: z.literal(STATE_VERSION),
    expiresAtMs: z.number().int().positive(),
    toolName: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    argumentsDigest: z.string().regex(DIGEST_PATTERN),
    credentialDigest: z.string().regex(DIGEST_PATTERN),
    idempotencyKey: z.string().regex(UUID_V4_PATTERN),
  })
  .strict();

const confirmationInputSchema = z
  .object({
    confirm: z.boolean().describe("Approve this exact Avala mutation"),
  })
  .strict();

const CONFIRMATION_REQUESTED_SCHEMA = {
  type: "object" as const,
  properties: {
    confirm: {
      type: "boolean" as const,
      title: "Approve this exact mutation",
    },
  },
  required: ["confirm"],
};

const CONFIRMATION_INPUT_KEY = "confirmAvalaMutation";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function base64Digest(value: string): string {
  return digest(value).toString("base64url");
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      )
      .map(([key, child]) => [key, canonicalValue(child)]),
  );
}

function argumentsDigest(argumentsValue: unknown): string {
  const serialized = JSON.stringify(canonicalValue(argumentsValue));
  if (serialized === undefined) throw invalidConfirmation();
  return base64Digest(serialized);
}

function invalidConfirmation(): Error {
  // Decrypt, schema, expiry, argument, tool and credential failures stay
  // indistinguishable so this boundary cannot become a token oracle.
  return new Error("Invalid or expired mutation confirmation.");
}

function deriveKey(keyMaterial: string | Uint8Array): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      keyMaterial,
      Buffer.from("avala-mcp", "utf8"),
      STATE_AAD,
      32,
    ),
  );
}

export interface MutationConfirmationService {
  issue(toolName: string, args: unknown, credentialBinding: string): string;
  verify(
    state: string,
    toolName: string,
    args: unknown,
    credentialBinding: string,
  ): string;
}

export function createMutationConfirmationService(
  keyMaterial: string | Uint8Array = PROCESS_KEY_MATERIAL,
  now: () => number = Date.now,
): MutationConfirmationService {
  const key = deriveKey(keyMaterial);

  return {
    issue(toolName, args, credentialBinding): string {
      if (!credentialBinding || credentialBinding.length > 512) {
        throw invalidConfirmation();
      }
      const envelope = confirmationEnvelopeSchema.parse({
        version: STATE_VERSION,
        expiresAtMs: now() + STATE_TTL_MS,
        toolName,
        argumentsDigest: argumentsDigest(args),
        credentialDigest: base64Digest(credentialBinding),
        idempotencyKey: randomUUID(),
      });
      const iv = randomBytes(AES_GCM_IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(STATE_AAD);
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(envelope), "utf8"),
        cipher.final(),
      ]);
      const state = `${STATE_PREFIX}${Buffer.concat([
        iv,
        cipher.getAuthTag(),
        ciphertext,
      ]).toString("base64url")}`;
      if (state.length > STATE_MAX_LENGTH) throw invalidConfirmation();
      return state;
    },

    verify(state, toolName, args, credentialBinding): string {
      try {
        if (
          !STATE_PATTERN.test(state) ||
          state.length > STATE_MAX_LENGTH ||
          !credentialBinding ||
          credentialBinding.length > 512
        ) {
          throw invalidConfirmation();
        }
        const packed = Buffer.from(state.slice(STATE_PREFIX.length), "base64url");
        if (packed.length <= AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES) {
          throw invalidConfirmation();
        }
        const iv = packed.subarray(0, AES_GCM_IV_BYTES);
        const tag = packed.subarray(
          AES_GCM_IV_BYTES,
          AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES,
        );
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(STATE_AAD);
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
        const expectedArguments = digest(argumentsDigest(args));
        const receivedArguments = digest(envelope.argumentsDigest);
        const expectedCredential = digest(base64Digest(credentialBinding));
        const receivedCredential = digest(envelope.credentialDigest);
        if (
          envelope.expiresAtMs <= now() ||
          envelope.toolName !== toolName ||
          receivedArguments.length !== expectedArguments.length ||
          !timingSafeEqual(receivedArguments, expectedArguments) ||
          receivedCredential.length !== expectedCredential.length ||
          !timingSafeEqual(receivedCredential, expectedCredential)
        ) {
          throw invalidConfirmation();
        }
        return envelope.idempotencyKey;
      } catch {
        throw invalidConfirmation();
      }
    },
  };
}

export interface MutationRouteDefinition<InputSchema extends AnyZodObject> {
  /** Stable Django URL name from server/api_route_manifest.json. */
  name: string;
  method: "POST";
  path: string;
  scope: string;
  toolset: "staff";
  body: (args: z.infer<InputSchema>) => Record<string, unknown>;
}

export interface MutationPreview {
  /** Exact operation shown to the human approval surface. */
  message: string;
}

export interface MutationCatalogToolDefinition<
  InputSchema extends AnyZodObject,
  OutputSchema extends AnyZodObject,
> {
  name: string;
  title: string;
  description: string;
  inputSchema: InputSchema;
  outputSchema: OutputSchema;
  route: MutationRouteDefinition<InputSchema>;
  preview: (args: z.infer<InputSchema>) => MutationPreview;
  reversalGuidance: (args: z.infer<InputSchema>) => string;
}

export interface MutationRegistrationOptions {
  confirmation: MutationConfirmationService;
  /** Current credential, already reduced to a non-secret keyed digest. */
  credentialBinding: string;
}

export function defineMutationCatalogTool<
  InputSchema extends AnyZodObject,
  OutputSchema extends AnyZodObject,
>(
  definition: MutationCatalogToolDefinition<InputSchema, OutputSchema>,
): MutationCatalogToolDefinition<InputSchema, OutputSchema> {
  return definition;
}

function refusal(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function safeStructuredContent<OutputSchema extends AnyZodObject>(
  schema: OutputSchema,
  value: unknown,
): z.infer<OutputSchema> {
  const parsed = schema.parse(value);
  return schema.parse(sanitizeForOutput(parsed)) as z.infer<OutputSchema>;
}

const MUTATION_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/** Register one reviewed REST-backed mutation with mandatory MCP approval. */
export function registerMutationCatalogTool<
  InputSchema extends AnyZodObject,
  OutputSchema extends AnyZodObject,
>(
  server: McpServer,
  getClient: GetClient,
  definition: MutationCatalogToolDefinition<InputSchema, OutputSchema>,
  options: MutationRegistrationOptions,
): void {
  server.registerTool<OutputSchema, InputSchema>(
    definition.name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema,
      outputSchema: definition.outputSchema,
      annotations: { title: definition.title, ...MUTATION_ANNOTATIONS },
      _meta: {
        "avala.ai/rest-route": definition.route.name,
        "avala.ai/rest-method": definition.route.method,
        "avala.ai/required-scope": definition.route.scope,
        "avala.ai/toolset": definition.route.toolset,
        "avala.ai/requires-confirmation": true,
        "avala.ai/idempotency-header": "Idempotency-Key",
      },
    },
    (async (args: z.infer<InputSchema>, context: ServerContext) => {
      const credentialBinding = options.credentialBinding;
      let idempotencyKey: string;

      if (context.mcpReq.envelope !== undefined) {
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
            return refusal("Avala mutation was not approved.");
          }
          if (response.kind === "elicit" && response.action === "accept") {
            return refusal("Avala mutation approval was invalid.");
          }
          const preview = definition.preview(args);
          return inputRequired({
            inputRequests: {
              [CONFIRMATION_INPUT_KEY]: inputRequired.elicit({
                message: preview.message,
                requestedSchema: CONFIRMATION_REQUESTED_SCHEMA,
              }),
            },
            requestState: options.confirmation.issue(
              definition.name,
              args,
              credentialBinding,
            ),
          });
        }
        const requestState = context.mcpReq.requestState<string>();
        if (typeof requestState !== "string") throw invalidConfirmation();
        idempotencyKey = options.confirmation.verify(
          requestState,
          definition.name,
          args,
          credentialBinding,
        );
      } else {
        const preview = definition.preview(args);
        const elicited = await context.mcpReq.elicitInput({
          mode: "form",
          message: preview.message,
          requestedSchema: CONFIRMATION_REQUESTED_SCHEMA,
        });
        const confirmed = confirmationInputSchema.safeParse(elicited.content);
        if (
          elicited.action !== "accept" ||
          !confirmed.success ||
          confirmed.data.confirm !== true
        ) {
          return refusal("Avala mutation was not approved.");
        }
        idempotencyKey = randomUUID();
      }

      const path = renderCatalogPath(
        definition.route.path,
        args as Record<string, unknown>,
      );
      const raw = await getClient(definition.name).transport.requestCreate<
        Record<string, unknown>
      >(path, definition.route.body(args), { idempotencyKey });
      const structuredContent = safeStructuredContent(definition.outputSchema, {
        ...raw,
        reversalGuidance: definition.reversalGuidance(args),
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
    }) as unknown as ToolCallback<InputSchema>,
  );
}
