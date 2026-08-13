import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Vendored emulator cores: minified Emscripten glue, not our source. Half a
    // dozen rules fire on it and none of them mean anything here (D-006, D-026).
    "public/emulator/**",
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Compiler output from the native runtime harness, not source.
    ".native-build/**",
  ]),
]);

export default eslintConfig;
