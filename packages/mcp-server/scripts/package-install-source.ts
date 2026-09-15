import assert from "node:assert/strict";

export type PackageSource =
  | { kind: "workspace" }
  | { kind: "registry"; version: string };

export interface PackageManifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

/** Validate before creating scratch files or making any registry request. */
export function parsePackageSource(args: string[]): PackageSource {
  if (args.length === 0) return { kind: "workspace" };
  const [flag, version] = args;
  assert(
    args.length === 2 && flag === "--registry-version" &&
      version === version.trim() &&
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) &&
      version.split(".").every((part) => Number.isSafeInteger(Number(part))),
    "Usage: verify-package-install.ts [--registry-version X.Y.Z] (exact stable version only)",
  );
  return { kind: "registry", version };
}

export function assertPackageManifest(
  manifest: PackageManifest,
  name: string,
  source: PackageSource,
): void {
  assert.equal(manifest.name, name);
  if (source.kind === "registry") assert.equal(manifest.version, source.version);
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
    for (const spec of Object.values(manifest[field] ?? {})) {
      assert(!/^(workspace|file|link):/.test(spec), `Non-portable dependency: ${spec}`);
    }
  }
  for (const hook of ["preinstall", "install", "postinstall"]) {
    assert(!(hook in (manifest.scripts ?? {})), `Unexpected package lifecycle hook: ${hook}`);
  }
}

export function installTargets(
  source: PackageSource,
  sdkTarball: string,
  mcpTarball: string,
): string[] {
  // Registry mode must resolve the SDK from npm through MCP's actual edge.
  // Supplying an SDK tarball directly could hide a broken published dependency.
  return source.kind === "registry" ? [mcpTarball] : [sdkTarball, mcpTarball];
}
