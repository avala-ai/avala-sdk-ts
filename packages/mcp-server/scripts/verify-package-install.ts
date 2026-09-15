/** Exercise the npm artifacts, not Bun's workspace links. Never publishes. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  assertPackageManifest,
  installTargets,
  parsePackageSource,
  type PackageManifest,
} from "./package-install-source.js";

const source = parsePackageSource(process.argv.slice(2));
const workspace = fileURLToPath(new URL("../../..", import.meta.url));
// Canonicalize macOS /var -> /private/var (and other symlinked temp roots)
// before comparing the installed executable's real path below.
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "avala-package-install-")));
const installDir = join(scratch, "consumer");
mkdirSync(installDir);

// Do not pass developer/CI secrets, npm auth config, NODE_PATH, or NODE_OPTIONS
// into pack/install or the installed server. Each config path is distinct.
const cleanEnv: Record<string, string> = { PATH: process.env.PATH ?? "" };
const npmEnv = {
  ...cleanEnv,
  npm_config_userconfig: join(scratch, "user.npmrc"),
  npm_config_globalconfig: join(scratch, "global.npmrc"),
  npm_config_cache: join(scratch, "cache"),
  npm_config_registry: "https://registry.npmjs.org",
};

function npm(args: string[], cwd: string): string {
  return execFileSync("npm", args, {
    cwd,
    env: npmEnv,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function pack(name: string): { tarball: string; manifest: PackageManifest; integrity: string } {
  // npm <=11 returns an array; npm 12 keys workspace results by package name.
  const packed: { filename: string; integrity: string }[] = Object.values(
    JSON.parse(
      npm(
        source.kind === "registry"
          ? ["pack", `${name}@${source.version}`, "--prefix", installDir, "--ignore-scripts", "--pack-destination", scratch, "--json"]
          : ["pack", "--workspace", name, "--pack-destination", scratch, "--json"],
        source.kind === "registry" ? installDir : workspace,
      ),
    ),
  );
  assert.equal(packed.length, 1);
  const tarball = join(scratch, packed[0].filename);
  const manifest: PackageManifest = JSON.parse(
    execFileSync("tar", ["-xOf", tarball, "package/package.json"], {
      encoding: "utf8",
      env: cleanEnv,
      timeout: 10_000,
    }),
  );
  assertPackageManifest(manifest, name, source);
  assert.equal(typeof packed[0].integrity, "string");
  return { tarball, manifest, integrity: packed[0].integrity };
}

let apiCalls = 0;
const api = createServer((_request, response) => {
  apiCalls += 1;
  response.writeHead(500).end("Package catalog smoke must not call the API");
});
const client = new Client({
  name: "avala-package-install-test",
  version: "1.0.0",
});

try {
  const sdk = pack("@avala-ai/sdk");
  const mcp = pack("@avala-ai/mcp-server");
  assert.equal(mcp.manifest.version, sdk.manifest.version);
  assert.equal(
    mcp.manifest.dependencies?.[sdk.manifest.name],
    sdk.manifest.version,
  );

  // Only local packing supplies an unpublished SDK directly. Registry mode
  // must resolve MCP's SDK dependency normally from the public registry.
  npm(
    [
      "install",
      // Pin the consumer even when an ancestor has package.json/node_modules.
      "--prefix", installDir,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      ...installTargets(source, sdk.tarball, mcp.tarball),
    ],
    installDir,
  );
  const installedSdk: PackageManifest = JSON.parse(
    readFileSync(
      join(installDir, "node_modules/@avala-ai/sdk/package.json"),
      "utf8",
    ),
  );
  assertPackageManifest(installedSdk, sdk.manifest.name, source);
  assert.equal(installedSdk.version, sdk.manifest.version);
  const installedMcp: PackageManifest = JSON.parse(
    readFileSync(join(installDir, "node_modules/@avala-ai/mcp-server/package.json"), "utf8"),
  );
  assertPackageManifest(installedMcp, mcp.manifest.name, source);
  assert.equal(installedMcp.version, mcp.manifest.version);
  assert.equal(installedMcp.dependencies?.[sdk.manifest.name], installedSdk.version);

  // Install the complete skill from the npm consumer, never from the monorepo.
  // Explicit installation is required; npm lifecycle scripts must not alter a
  // user's agent configuration or skill directories.
  const skillName = "avala-physical-ai-operations";
  const installedSkills = join(installDir, "node_modules/@avala-ai/mcp-server/skills");
  assert(lstatSync(installedSkills).isDirectory());
  assert.deepEqual(readdirSync(installedSkills), [skillName]);
  const installedSkill = join(installedSkills, skillName);
  assert(lstatSync(installedSkill).isDirectory());
  const skillFiles = ["SKILL.md", "agents/openai.yaml", "references/tool-map.md"];
  assert.deepEqual(
    readdirSync(installedSkill, { recursive: true }).sort(),
    ["SKILL.md", "agents", "agents/openai.yaml", "references", "references/tool-map.md"],
    "The installed skill must include its complete, reviewed resource set",
  );
  for (const path of ["agents", "references", ...skillFiles]) {
    assert(!lstatSync(join(installedSkill, path)).isSymbolicLink());
  }
  const agentSkills = join(installDir, ".agents/skills");
  mkdirSync(agentSkills, { recursive: true });
  const copiedSkill = join(agentSkills, skillName);
  const copyOptions = { recursive: true, force: false, errorOnExist: true };
  cpSync(installedSkill, copiedSkill, copyOptions);
  for (const path of skillFiles) {
    assert(!lstatSync(join(installedSkill, path)).isSymbolicLink());
    assert.equal(
      readFileSync(join(copiedSkill, path), "utf8"),
      source.kind === "registry"
        ? execFileSync("tar", ["-xOf", mcp.tarball, `package/skills/${skillName}/${path}`], {
          encoding: "utf8", env: cleanEnv, timeout: 10_000, maxBuffer: 1024 * 1024,
        })
        : readFileSync(join(workspace, "packages/mcp-server/skills", skillName, path), "utf8"),
      `Installed skill differs from the selected source: ${path}`,
    );
  }
  assert.throws(
    () => cpSync(installedSkill, copiedSkill, copyOptions),
    "A skill reinstall must not silently overwrite an existing copy",
  );

  const binary = join(installDir, "node_modules/.bin/avala-mcp-server");
  assert.equal(
    realpathSync(binary),
    join(installDir, "node_modules/@avala-ai/mcp-server/dist/index.js"),
  );

  await new Promise<void>((resolve, reject) => {
    api.once("error", reject);
    api.listen(0, "127.0.0.1", resolve);
  });
  const address = api.address();
  assert(address && typeof address !== "string");
  const transport = new StdioClientTransport({
    command: "node",
    args: [binary],
    cwd: installDir,
    env: {
      ...cleanEnv,
      AVALA_API_KEY: "package-smoke-placeholder-not-a-credential",
      AVALA_BASE_URL: `http://127.0.0.1:${address.port}`,
    },
    stderr: "inherit",
  });
  await client.connect(transport, { timeout: 15_000 });
  assert.equal(client.getServerVersion()?.version, installedMcp.version);
  const catalog = await client.listTools({}, { timeout: 15_000 });
  const names = new Set(catalog.tools.map((tool) => tool.name));
  assert(
    names.has("list_projects"),
    "Installed package must expose the read catalog",
  );
  assert(
    names.has("inspect_customer_qc_context"),
    "Installed package must contain the current QC read tool",
  );
  assert(
    !names.has("create_project"),
    "Mutations must remain disabled by default",
  );
  assert.equal(apiCalls, 0);
  console.log(
    `${source.kind} npm artifacts install and initialize under Node: ${names.size} read-only tools; complete skill installed; no API calls`,
  );
  console.log(JSON.stringify({
    source,
    version: installedMcp.version,
    integrity: { sdk: sdk.integrity, mcp: mcp.integrity },
    node: execFileSync("node", ["--version"], { encoding: "utf8", env: cleanEnv, timeout: 10_000 }).trim(),
  }));
} finally {
  try {
    await client.close();
  } finally {
    api.closeAllConnections();
    await new Promise<void>((resolve) => api.close(() => resolve()));
    // Only this process's mkdtemp-owned build/test artifacts are removed.
    rmSync(scratch, { recursive: true, force: true });
  }
}
