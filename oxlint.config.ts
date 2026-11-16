import { defineConfig } from "oxlint";

export default defineConfig({
  ignorePatterns: [
    ".audit/**",
    ".agents/skills/*",
    "!.agents/skills/verify-artifacts",
    "!.agents/skills/verify-batch-concurrency",
    ".claude/**",
    ".native/**",
    ".test-artifacts/**",
    "**/dist/**",
  ],
  jsPlugins: [{ name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" }],
  rules: {
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "no-unused-vars": ["warn", { argsIgnorePattern: "^_", ignoreRestSiblings: true, varsIgnorePattern: "^_" }],
  },
});
