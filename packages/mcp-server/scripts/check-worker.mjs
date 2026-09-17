import { spawnSync } from "node:child_process";

// SDK CI retains Node 18/20. Worker tooling runs on the existing Node 22 job.
if (Number(process.versions.node.split(".")[0]) < 22) {
  console.log(
    "Worker typecheck skipped: Wrangler requires Node >=22; SDK checks still run.",
  );
} else {
  for (const args of [
    ["run", "worker:types"],
    ["x", "--no-install", "tsc", "--project", "worker/tsconfig.json"],
  ]) {
    const result = spawnSync("bun", args, { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
