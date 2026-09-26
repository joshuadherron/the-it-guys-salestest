export default [
  { ignores: ["node_modules/**", ".tmp/**"] },
  {
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "no-unreachable": "error",
      "no-constant-condition": "error",
      "valid-typeof": "error",
      eqeqeq: ["error", "always"],
    },
  },
];
