import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Compiler output from the native runtime harness, not source.
    ".native-build/**",
    // Same, for the browser-test harness. `npm run verify` runs lint first and
    // leaves this behind, so without the ignore the suite passes once and then
    // fails on its own output.
    ".test-build/**",
    // Generated games. Each is a real SDK project with its own node_modules,
    // and none of it is this repository's source.
    ".forge/**",
  ]),
]);

export default eslintConfig;
