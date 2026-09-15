import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/http.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  // Published executables must not expose internal source/review commentary.
  // Keep identifiers intact for stack traces while stripping source comments.
  esbuildOptions(options) {
    options.minifyWhitespace = true;
    options.legalComments = "none";
  },
  banner: {
    js: "#!/usr/bin/env node",
  },
});
