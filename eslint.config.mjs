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
    // Bind mount Postgres en prod (appartient a root/ollama, 700) : eslint
    // plante en EACCES en essayant de le lister depuis le ThinkStation.
    "db/**",
  ]),
]);

export default eslintConfig;
