import js from "@eslint/js";
import tseslint from "typescript-eslint";

const typedConfigs = tseslint.configs.recommendedTypeChecked.map((config) => ({
  ...config,
  files: ["**/*.{ts,tsx}"],
}));

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.expo/**", "**/node_modules/**"] },
  {
    ...js.configs.recommended,
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
  },
  ...typedConfigs,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
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
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        AggregateError: "readonly",
        Buffer: "readonly",
        Response: "readonly",
        URL: "readonly",
        console: "readonly",
        fetch: "readonly",
        module: "readonly",
        process: "readonly",
        require: "readonly",
        setTimeout: "readonly",
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
