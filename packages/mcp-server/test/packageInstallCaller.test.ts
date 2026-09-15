/** Simulated registry orchestration, not evidence of a published release. */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exec: vi.fn(), tmpdir: vi.fn(), connect: vi.fn(), close: vi.fn(), version: vi.fn(),
}));
vi.mock("node:child_process", () => ({ execFileSync: mocks.exec }));
vi.mock("node:os", () => ({ tmpdir: mocks.tmpdir }));
vi.mock("@modelcontextprotocol/client", () => ({
  Client: class {
    connect = mocks.connect;
    close = mocks.close;
    getServerVersion = mocks.version;
    async listTools(): Promise<{ tools: { name: string }[] }> {
      return { tools: [{ name: "list_projects" }, { name: "inspect_customer_qc_context" }] };
    }
  },
}));
vi.mock("@modelcontextprotocol/client/stdio", () => ({
  StdioClientTransport: class {
    constructor(options: { env: Record<string, string>; command: string }) {
      expect(options.command).toBe("node");
      expect(Object.keys(options.env).sort()).toEqual(["AVALA_API_KEY", "AVALA_BASE_URL", "PATH"]);
      expect(options.env.AVALA_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:/);
    }
  },
}));

const { execFileSync: realExec } = await vi.importActual<typeof import("node:child_process")>("node:child_process");
const { tmpdir: realTmpdir } = await vi.importActual<typeof import("node:os")>("node:os");
const skillName = "avala-physical-ai-operations";
const skillFiles = ["SKILL.md", "agents/openai.yaml", "references/tool-map.md"];
const version = "1.2.3";
const sdk = { name: "@avala-ai/sdk", version };
const mcp = { name: "@avala-ai/mcp-server", version, dependencies: { [sdk.name]: version } };
const publishedSkill = "Simulated older published skill, intentionally unlike this checkout.\n";
let root: string;
let savedArgv: string[];

function writeFixture(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function assertCleaned(): void {
  expect(readdirSync(root).sort()).toEqual([".npmrc", "package.json"]);
}

async function runCaller(): Promise<void> {
  await import("../scripts/verify-package-install.js");
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  root = mkdtempSync(join(realTmpdir(), "avala-package-caller-test-"));
  writeFixture(join(root, "package.json"), '{"name":"ancestor-fixture","private":true}');
  writeFixture(join(root, ".npmrc"), "registry=https://ancestor.invalid\n");
  savedArgv = process.argv;
  process.argv = ["bun", "verify-package-install.ts", "--registry-version", version];
  mocks.tmpdir.mockReturnValue(root);
  mocks.version.mockReturnValue({ name: mcp.name, version });
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  mocks.exec.mockImplementation((command: string, args: string[], options: { cwd?: string; env: Record<string, string> }) => {
    if (command === "node") return "v22.0.0\n";
    if (command === "tar") {
      const manifest = args[1].endsWith("sdk.tgz") ? sdk : mcp;
      return args[2] === "package/package.json" ? JSON.stringify(manifest) : publishedSkill;
    }
    expect(command).toBe("npm");
    const consumer = options.cwd!;
    expect(args.slice(args.indexOf("--prefix"), args.indexOf("--prefix") + 2)).toEqual(["--prefix", consumer]);
    expect(Object.keys(options.env).sort()).toEqual([
      "PATH", "npm_config_cache", "npm_config_globalconfig", "npm_config_registry", "npm_config_userconfig",
    ]);
    expect(options.env.npm_config_registry).toBe("https://registry.npmjs.org");
    expect(args).toContain("--ignore-scripts");
    if (args[0] === "pack") {
      expect(args[1]).toMatch(/^@avala-ai\/(sdk|mcp-server)@1\.2\.3$/);
      expect(args).not.toContain("--workspace");
      const filename = args[1].startsWith(`${sdk.name}@`) ? "sdk.tgz" : "mcp.tgz";
      return JSON.stringify([{ filename, integrity: `simulated-${filename}` }]);
    }
    expect(args[0]).toBe("install");
    expect(args.filter((arg) => arg.endsWith(".tgz"))).toEqual([join(consumer, "..", "mcp.tgz")]);
    for (const manifest of [sdk, mcp]) {
      writeFixture(join(consumer, "node_modules", manifest.name, "package.json"), JSON.stringify(manifest));
    }
    const installed = join(consumer, "node_modules", mcp.name);
    for (const path of skillFiles) writeFixture(join(installed, "skills", skillName, path), publishedSkill);
    writeFixture(join(installed, "dist/index.js"), "// Simulated executable; never launched.\n");
    mkdirSync(join(consumer, "node_modules/.bin"));
    symlinkSync(join(installed, "dist/index.js"), join(consumer, "node_modules/.bin/avala-mcp-server"));
    return "";
  });
});

afterEach(() => {
  process.argv = savedArgv;
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("simulated registry caller", () => {
  it("uses published skill bytes and MCP-only install, labels provenance, then cleans up", async () => {
    const checkout = readFileSync(new URL(`../skills/${skillName}/SKILL.md`, import.meta.url), "utf8");
    expect(checkout).not.toBe(publishedSkill);
    await runCaller();
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("registry npm artifacts"));
    expect(console.log).toHaveBeenCalledWith(JSON.stringify({
      source: { kind: "registry", version }, version,
      integrity: { sdk: "simulated-sdk.tgz", mcp: "simulated-mcp.tgz" }, node: "v22.0.0",
    }));
    assertCleaned();
  });

  it("refuses registry failures without a workspace fallback and removes scratch files", async () => {
    mocks.exec.mockImplementation(() => { throw new Error("simulated registry unavailable"); });
    await expect(runCaller()).rejects.toThrow("simulated registry unavailable");
    expect(mocks.exec).toHaveBeenCalledOnce();
    expect(mocks.exec.mock.calls[0][1]).not.toContain("--workspace");
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
    assertCleaned();
  });

  it("rejects an installed protocol version mismatch and cleans up", async () => {
    mocks.version.mockReturnValue({ name: mcp.name, version: "0.0.0" });
    await expect(runCaller()).rejects.toThrow();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(console.log).not.toHaveBeenCalled();
    assertCleaned();
  });

  it("rejects a non-semver numeric component before scratch creation or npm calls", async () => {
    process.argv[3] = "9007199254740992.0.0";
    await expect(runCaller()).rejects.toThrow(/Usage/);
    expect(mocks.tmpdir).not.toHaveBeenCalled();
    expect(mocks.exec).not.toHaveBeenCalled();
    assertCleaned();
  });

  it("pins real npm's project boundary away from an ancestor .npmrc", () => {
    const consumer = join(root, "empty-consumer");
    mkdirSync(consumer);
    const env = {
      PATH: process.env.PATH,
      npm_config_userconfig: join(consumer, "user.npmrc"),
      npm_config_globalconfig: join(consumer, "global.npmrc"),
      npm_config_cache: join(consumer, "cache"),
    };
    const run = (args: string[]): string => realExec("npm", args, {
      cwd: consumer, env, encoding: "utf8", timeout: 10_000,
    }).trim();
    // Without the CLI prefix npm reads the ancestor project; with it neither
    // registry configuration nor the install destination escapes the consumer.
    expect(run(["config", "get", "registry"])).toBe("https://ancestor.invalid");
    expect(run(["config", "get", "registry", "--prefix", consumer])).toBe("https://registry.npmjs.org/");
    expect(run(["prefix", "--prefix", consumer])).toBe(consumer);
  });
});
