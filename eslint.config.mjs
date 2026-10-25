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
    rules: {
      // A leading _ marks a name left unused on purpose (an interface's
      // argument, a mock's).
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
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
    // typescript-eslint turns off the core rules TypeScript already checks
    // (no-undef, no-import-assign and others) only in .ts files. Its
    // prefer-const stays out: Svelte's `let { a } = $props()` is meant.
    rules: Object.fromEntries(
      Object.entries(ts.configs.eslintRecommended.rules).filter(([, level]) => level === 'off'),
    ),
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
    // Mocks and fixtures in tests are often loosely typed on purpose, and
    // expect(obj.method) and vi.mocked(obj.method) never call the method
    // unbound.
    files: ['**/*.test.ts', '**/__mocks__/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
