// @ts-check
const tseslint = require('typescript-eslint');
const eslintConfigPrettier = require('eslint-config-prettier');

/**
 * Shared ESLint flat-config base for TypeScript packages/apps in this monorepo.
 * Individual apps compose this with framework-specific configs (e.g. Next.js,
 * NestJS) rather than importing it verbatim where that would conflict.
 */
module.exports = tseslint.config(
  {
    ignores: [
      'dist/**',
      'build/**',
      '.next/**',
      'node_modules/**',
      'coverage/**',
      '**/*.d.ts',
      // Flat-config files themselves must use require() (loaded before any
      // module system is known) — never lint them with the rules they define.
      '**/eslint.config.{js,cjs,mjs}',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  eslintConfigPrettier,
);
