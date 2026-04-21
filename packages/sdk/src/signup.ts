import { resolveBaseUrl } from "./client.js";
import {
  AuthenticationError,
  AvalaError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
} from "./errors.js";
import { snakeToCamel } from "./http.js";
import type { SignupResponse } from "./types.js";

const DEFAULT_BASE_URL = "https://api.avala.ai/api/v1";
const DEFAULT_TIMEOUT = 30_000;

export interface SignupOptions {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  baseUrl?: string;
  timeout?: number;
}

async function handleError(response: Response): Promise<never> {
  let body: unknown;
  let message = `HTTP ${response.status}`;
  try {
    body = await response.json();
    if (typeof body === "object" && body !== null) {
      if ("detail" in body) {
        message = (body as { detail: string }).detail;
      } else {
        const entries = Object.entries(body as Record<string, unknown>);
        const fieldErrors: string[] = [];
        for (const [field, errors] of entries) {
          if (Array.isArray(errors)) {
            fieldErrors.push(`${field}: ${errors.join(", ")}`);
          }
        }
        if (fieldErrors.length > 0) {
          message = fieldErrors.join("; ");
        }
      }
    }
  } catch {
    // ignore JSON parse errors
  }

  const status = response.status;
  if (status === 401) throw new AuthenticationError(message, body);
  if (status === 404) throw new NotFoundError(message, body);
  if (status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    throw new RateLimitError(message, body, retryAfter ? parseFloat(retryAfter) : null);
  }
  if (status === 400 || status === 422) {
    throw new ValidationError(message, status, body);
  }
  if (status >= 500) throw new ServerError(message, status, body);
  throw new AvalaError(message, status, body);
}

/**
 * Create a new Avala account.
 *
 * This is a standalone function that does **not** require an API key.
 * On success it returns a {@link SignupResponse} containing the created
 * user and their API key.
 */
export async function signup(options: SignupOptions): Promise<SignupResponse> {
  // Validate the base URL — signup sends the user's password, so a rogue env
  // var like AVALA_BASE_URL=http://evil.example.com would otherwise leak it.
  // resolveBaseUrl enforces https: unless AVALA_ALLOW_INSECURE_BASE_URL=true
  // and the host is localhost.
  const rawBaseUrl = options.baseUrl ?? process.env.AVALA_BASE_URL ?? DEFAULT_BASE_URL;
  const baseUrl = resolveBaseUrl(rawBaseUrl);
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;

  const payload: Record<string, string> = {
    email: options.email,
    password: options.password,
  };
  if (options.firstName !== undefined) payload.first_name = options.firstName;
  if (options.lastName !== undefined) payload.last_name = options.lastName;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${baseUrl}/signup/`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      // Never follow redirects — the signup payload contains the user's password.
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      throw new AvalaError(
        `Unexpected redirect (HTTP ${response.status}) from signup endpoint. The SDK does not follow redirects to avoid leaking credentials.`,
        response.status,
        null,
      );
    }

    if (!response.ok) {
      await handleError(response);
    }

    const raw = (await response.json()) as Record<string, unknown>;
    return snakeToCamel(raw) as unknown as SignupResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}
