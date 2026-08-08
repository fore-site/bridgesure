import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Shared ESLint flat config for BridgeSure TypeScript packages.
 * Enforces the AGENTS.md coding rules: no `any`, no non-null assertions,
 * no default exports, no unchecked casts, typed error handling.
 *
 * Consumers extend this and set `languageOptions.parserOptions.project`
 * to their own tsconfig for type-aware linting.
 *
 * @type {import("typescript-eslint").ConfigArray}
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.config.js',
      '**/*.config.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // AGENTS.md: avoid `any`, non-null assertions, default exports, unchecked casts.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'Default exports are disallowed; use named exports (AGENTS.md).',
        },
        {
          selector: 'TSAsExpression[typeAnnotation.typeName.name!="const"]',
          message:
            'Avoid `as` type casts; validate external data with schemas and narrow with type guards (AGENTS.md).',
        },
      ],
      // AGENTS.md: model expected failures with typed results/errors; no thrown strings,
      // no silently swallowed errors.
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
);
