import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  // Component `import "./X.css"` statements are collected into dist/index.css,
  // exported as "@djamo/design-system/styles.css".
});
