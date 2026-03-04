import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "out/**",
      "dist/**",
      "node_modules/**",
      "tests/**",
      "*.js",
      "*.mjs",
    ],
  },

  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript recommended (type-aware not needed — keeps it fast)
  ...tseslint.configs.recommended,

  // Main process files (Node environment)
  {
    files: ["src/main/**/*.ts", "src/preload/**/*.ts", "src/shared/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Renderer files (browser + React environment)
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  // Project-wide rule overrides
  {
    rules: {
      // Allow unused vars with underscore prefix (common pattern)
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Allow explicit any in specific cases but warn
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow require imports in Electron main process
      "@typescript-eslint/no-require-imports": "off",
      // Allow empty catch blocks (used for optional error handling)
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
