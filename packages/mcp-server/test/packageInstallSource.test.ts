import { describe, expect, it } from "vitest";
import {
  assertPackageManifest,
  installTargets,
  parsePackageSource,
  type PackageManifest,
} from "../scripts/package-install-source.js";

describe("package verification source", () => {
  it("retains the no-argument local artifact check", () => {
    expect(parsePackageSource([])).toEqual({ kind: "workspace" });
  });

  it.each(["0.7.4", "0.8.0", "1.0.0", "12.34.56"])(
    "requires an exact stable registry version: %s",
    (version) => {
      expect(parsePackageSource(["--registry-version", version])).toEqual({
        kind: "registry", version,
      });
    },
  );

  it.each([
    [], ["latest"], ["^1.0.0"], ["1.x"], ["v1.0.0"], ["01.0.0"],
    ["1.0.0-rc.1"], ["1.0.0+build"], ["1.0.0\n"], [" 1.0.0"],
    ["9007199254740992.0.0"], ["0.9007199254740992.0"], ["0.0.9007199254740992"],
    ["file:/tmp/package"], ["https://example.invalid/package.tgz"],
    ["--registry=https://example.invalid"], ["1.0.0", "ignored"],
  ])("refuses a missing, floating or extra registry argument: %j", (...args) => {
    expect(() => parsePackageSource(["--registry-version", ...args])).toThrow(/Usage/);
  });

  it("rejects unknown flags instead of silently using local artifacts", () => {
    expect(() => parsePackageSource(["--registry", "1.0.0"])).toThrow(/Usage/);
  });

  it("never injects a direct SDK artifact into a registry installation", () => {
    expect(installTargets({ kind: "registry", version: "1.0.0" }, "sdk.tgz", "mcp.tgz"))
      .toEqual(["mcp.tgz"]);
    expect(installTargets({ kind: "workspace" }, "sdk.tgz", "mcp.tgz"))
      .toEqual(["sdk.tgz", "mcp.tgz"]);
  });
});

describe("downloaded package identity", () => {
  const source = { kind: "registry", version: "1.0.0" } as const;
  const manifest: PackageManifest = {
    name: "@avala-ai/mcp-server", version: "1.0.0",
    dependencies: { "@avala-ai/sdk": "1.0.0" },
  };

  it("accepts matching, portable registry metadata", () => {
    expect(() => assertPackageManifest(manifest, manifest.name, source)).not.toThrow();
  });

  it("refuses a different package or version", () => {
    expect(() => assertPackageManifest(manifest, "@avala-ai/sdk", source)).toThrow();
    expect(() => assertPackageManifest({ ...manifest, version: "0.7.4" }, manifest.name, source)).toThrow();
  });

  it("does not impose a release version on local packing", () => {
    expect(() => assertPackageManifest(manifest, manifest.name, { kind: "workspace" })).not.toThrow();
  });

  it.each(["dependencies", "optionalDependencies", "peerDependencies"] as const)(
    "refuses local protocols in %s before npm install",
    (field) => {
      for (const spec of ["workspace:*", "file:../sdk", "link:../sdk"]) {
        expect(() => assertPackageManifest({ ...manifest, [field]: { bad: spec } }, manifest.name, source))
          .toThrow(/Non-portable dependency/);
      }
    },
  );

  it.each(["preinstall", "install", "postinstall"])("refuses a package %s hook", (hook) => {
    expect(() => assertPackageManifest({ ...manifest, scripts: { [hook]: "node setup.js" } }, manifest.name, source))
      .toThrow(/lifecycle hook/);
  });
});
