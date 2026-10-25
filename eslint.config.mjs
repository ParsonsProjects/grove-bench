import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import svelteConfig from './svelte.config.mjs';

// Errors the code already had when ESLint was added are listed in
// eslint-suppressions.json, so only new ones fail. After fixing some, run
// `npm run lint:prune` to drop them from that file.
export default defineConfig(
  globalIgnores(['dist/', 'out/', 'coverage/', '.vite/', '.grove-wt/', 'landing/', 'scripts/acp-spike/']),
  js.configs.recommended,
  ts.configs.recommendedTypeChecked,
  // After the TypeScript configs, so its parser handles .svelte files.
  svelte.configs.recommended,
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
        svelteConfig,
      },
    },
  },
  {
    // Plain JavaScript (scripts, configs, the MCP bridge) is outside
    // tsconfig.json, so it gets the rules that don't need types.
    files: ['**/*.{js,mjs,cjs,mts}'],
    extends: [ts.configs.disableTypeChecked],
  },
  {
    files: ['src/renderer/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/main/**', 'src/shared/**', 'scripts/**', '*.{js,mjs,cjs,mts}'],
    languageOptions: { globals: globals.node },
  },
  {
    // Mocks and fixtures in tests are often loosely typed on purpose.
    files: ['**/*.test.ts', '**/__mocks__/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
