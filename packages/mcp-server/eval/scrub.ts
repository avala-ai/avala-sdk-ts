/**
 * Cassette scrubbing — re-exported from the runtime scanner.
 *
 * The detection logic lives in `src/secrets.ts` because the SERVER needs it:
 * every tool response is scrubbed on the way out (`src/egress.ts`). Keeping a
 * second copy here would let the two drift, and the pair that drifts is exactly
 * the pair that must not — a cassette recorded by a scanner the runtime does
 * not share would prove nothing about what the runtime actually emits.
 */
export {
  findSecrets,
  formatFindings,
  scrubForCassette,
  scrubPersonNames,
  scrubString,
  scrubValue,
  type Finding,
  type SecretKind,
} from "../src/secrets.js";
