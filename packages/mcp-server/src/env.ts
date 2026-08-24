/** Parse a boolean-ish environment value ("1", "true", "yes", "on" => true). */
export function parseBooleanEnvValue(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
