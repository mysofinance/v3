import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["artifacts/**", "types/**"],
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.ts"],
  })),
];
