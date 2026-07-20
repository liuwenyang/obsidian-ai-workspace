import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig(
  globalIgnores(["node_modules", "coverage"]),
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-control-regex": "off",
      "no-implicit-globals": "off",
      "no-redeclare": "off",
      // The settings remain imperative for compatibility with Obsidian 1.7.2-1.12.
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          brands: ["AI Workspace", "ChatGPT", "Claude", "Claude Code", "Codex", "Markdown", "Obsidian", "ReClaude", "WebP"],
          acronyms: ["AI", "API", "GIF", "JPEG", "MCP", "PNG"],
          ignoreRegex: ["(?:^|\\s)(?:/|~/)"],
        },
      ],
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["scripts/**", "test/**"],
    rules: {
      "obsidianmd/rule-custom-message": "off",
    },
  },
);
