import { defineConfig } from "tsup";

export default defineConfig({
  entry: { tourguide: "src/cli.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  noExternal: [/.*/],
  outDir: "dist",
  outExtension: () => ({ js: ".mjs" }),
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __tourguideCreateRequire } from 'node:module'; const require = __tourguideCreateRequire(import.meta.url);" },
});
