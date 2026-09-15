import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: false,
  // The SDK is also installed with MCP; source/review comments stay private.
  esbuildOptions(options) {
    options.minifyWhitespace = true;
    options.legalComments = "none";
  },
});
