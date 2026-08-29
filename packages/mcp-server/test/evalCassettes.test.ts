/**
 * Build-failing half of the leakage gate.
 *
 * This runs in ordinary CI (`vitest run`), needs no API key, no network and no
 * eval run. It exists because the eval's own leakage gate only fires when
 * somebody runs the eval — whereas a cassette recorded from the real API is
 * committed to git the moment it is written, and a credential in git is already
 * a leak by the time anyone notices.
 *
 * It also pins the two properties that make `scrub.ts` safe to rely on:
 *   - the scrubber's output is never re-detected (otherwise this gate could
 *     never pass on a correctly scrubbed cassette);
 *   - `src/redact.ts` genuinely does NOT cover this, so deleting `scrub.ts` in
 *     favour of the existing redactor would reopen the hole.
 */

import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findSecrets, formatFindings, scrubForCassette } from "../eval/scrub.js";
import { sanitizeForOutput } from "../src/redact.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASSETTE_DIR = join(HERE, "..", "eval", "cassettes");

async function cassetteFiles(): Promise<string[]> {
  try {
    return (await readdir(CASSETTE_DIR)).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
}

describe("committed eval cassettes", () => {
  it("contain no credentials or personal data", async () => {
    const files = await cassetteFiles();
    const failures: string[] = [];

    for (const file of files) {
      const raw = await readFile(join(CASSETTE_DIR, file), "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        failures.push(`${file}: not valid JSON (${(error as Error).message})`);
        continue;
      }
      const findings = findSecrets(parsed);
      if (findings.length > 0) {
        failures.push(`${file}:\n${formatFindings(findings)}`);
      }
    }

    expect(
      failures,
      failures.length === 0
        ? ""
        : `Committed cassettes contain secrets or PII. Re-record with 'make eval-record' ` +
            `(which scrubs on write) and never hand-edit a cassette back to raw values.\n\n${failures.join("\n\n")}`,
    ).toEqual([]);
  });

  it("are scrubbed idempotently, so a re-record produces no diff churn", async () => {
    const files = await cassetteFiles();
    for (const file of files) {
      const parsed: unknown = JSON.parse(await readFile(join(CASSETTE_DIR, file), "utf8"));
      const body = (parsed as { body?: unknown }).body;
      expect(
        JSON.stringify(scrubForCassette(body)),
        `${file}: scrubbing the committed body changed it, so it was written unscrubbed ` +
          `or by an older scrubber.`,
      ).toEqual(JSON.stringify(body));
    }
  });
});

describe("scrub.ts covers what src/redact.ts cannot", () => {
  // Regression pin for the reason this module exists at all. `redact.ts`
  // matches KEY NAMES; a signed URL under a benign key sails straight through.
  const presigned =
    "https://bucket.s3.amazonaws.com/org/logo.png" +
    "?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE" +
    "&Signature=wJalrXUtnFEMIK7MDENGbPxRfiCY" +
    "&x-amz-security-token=FwoGZXIvYXdzEJrNotARealSessionTokenAtAll000";

  it("redact.ts leaves a credential in a benign key untouched", () => {
    const payload = { logo: presigned, contact: "annotator@example.com" };
    const redacted = sanitizeForOutput(payload) as Record<string, unknown>;
    expect(redacted.logo).toBe(presigned);
    expect(redacted.contact).toBe("annotator@example.com");
  });

  it("findSecrets catches it, and scrubbing removes every finding", () => {
    const payload = { logo: presigned, contact: "annotator@example.com" };
    expect(findSecrets(payload).length).toBeGreaterThan(0);

    const scrubbed = scrubForCassette(payload);
    expect(findSecrets(scrubbed)).toEqual([]);
    expect(JSON.stringify(scrubbed)).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(JSON.stringify(scrubbed)).not.toContain("annotator@example.com");
  });

  it("detects every credential class the recorder can encounter", () => {
    const cases: Record<string, unknown> = {
      awsKeyId: { k: "AKIAIOSFODNN7EXAMPLE" },
      stsKeyId: { k: "ASIAIOSFODNN7EXAMPLE" },
      jwt: {
        k: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      },
      bearer: { k: "Authorization: Bearer sk-abcdef0123456789abcdef" },
      email: { k: "reviewer.name@avala.ai" },
      phone: { k: "+254712345678" },
      signedParam: { k: "https://x/y?Signature=aVeryLongOpaqueSignatureValue123456" },
    };
    for (const [name, payload] of Object.entries(cases)) {
      expect(findSecrets(payload).length, `${name} was not detected`).toBeGreaterThan(0);
      expect(findSecrets(scrubForCassette(payload)), `${name} survived scrubbing`).toEqual([]);
    }
  });

  it("does not flag ordinary resource data", () => {
    // A gate that fires on dataset names and counts gets switched off.
    const payload = {
      results: [
        { name: "front-camera-2026", slug: "front-camera-2026", annotations_count: 40318 },
        { uid: "0f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8", status: "in_progress" },
        { next: "https://api.avala.ai/api/v1/datasets/?cursor=cD0yMDI2LTAzLTAx" },
      ],
    };
    expect(findSecrets(payload)).toEqual([]);
  });

  it("keeps resource names while removing person names", () => {
    const payload = {
      name: "front-camera-2026",
      owner: { name: "Jane Doe", email: "jane@example.com" },
    };
    const scrubbed = scrubForCassette(payload) as Record<string, unknown>;
    expect(scrubbed.name).toBe("front-camera-2026");
    expect(JSON.stringify(scrubbed)).not.toContain("Jane Doe");
  });
});
