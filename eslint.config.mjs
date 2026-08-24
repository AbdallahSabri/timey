import { dirname } from "path";
import { fileURLToPath } from "url";

import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig, globalIgnores } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = defineConfig([
  // next/core-web-vitals + next/typescript already register the "import"
  // plugin — re-declaring it via eslint-plugin-import's own flat configs
  // here would redefine the plugin instance and error. Only add the rule.
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    settings: {
      "import/resolver": {
        typescript: {
          project: "./tsconfig.json",
        },
      },
    },
    rules: {
      "import/order": [
        "warn",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
            "type",
          ],
          pathGroups: [
            {
              pattern: "@/**",
              group: "internal",
              position: "after",
            },
          ],
          "newlines-between": "always",
          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
        },
      ],
      // Type resolution is handled by tsc; avoid duplicate/slow resolution here.
      "import/no-unresolved": "off",
      "import/no-named-as-default": "off",
    },
  },
  // Must be last: disables stylistic rules that conflict with Prettier.
  eslintConfigPrettier,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Supabase CLI tree is SQL, TOML, and Deno — none of it belongs to
    // this project's Next/TypeScript toolchain, and `.temp/` is generated
    // scratch space regenerated on every `supabase start`.
    "supabase/**",
  ]),
]);

export default eslintConfig;
