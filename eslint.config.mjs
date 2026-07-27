import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.expo/**", "**/node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mjs", "scripts/*.mjs", "apps/mobile/app.config.cjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  {
    files: ["eslint.config.mjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ["scripts/*.mjs", "apps/mobile/app.config.cjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
        AggregateError: "readonly",
        require: "readonly",
        module: "readonly",
      },
    },
  },
  {
    files: ["apps/mobile/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
);
