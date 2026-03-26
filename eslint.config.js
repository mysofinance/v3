import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["artifacts/**", "types/**"],
  },
  {
    files: ["**/*.ts"],
    extends: tseslint.configs.recommended,
  },
  {
    files: ["test/**/*.ts", "scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
);
