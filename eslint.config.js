import config from '@bridgesure/config/eslint';
import tseslint from 'typescript-eslint';

/**
 * Root ESLint config. Enables type-aware linting across the workspace via the
 * TypeScript project service, then applies the shared BridgeSure ruleset.
 *
 * @type {import("typescript-eslint").ConfigArray}
 */
export default tseslint.config(
  ...config,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Test and config files live outside the package tsconfigs (they are
          // not emitted by `tsc`), so lint them with the default project.
          // (This typescript-eslint version bans `**` globs here.)
          allowDefaultProject: [
            'apps/*/test/*.test.ts',
            'apps/*/test/e2e/*.test.ts',
            'packages/*/test/*.test.ts',
            'apps/*/vitest*.ts',
            'packages/*/vitest*.ts',
          ],
          // The default cap (10) is exceeded by the test/vitest files;
          // provisioning scripts now belong to the api package project.
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 16,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Test files and config files run under a relaxed subset.
    files: ['**/*.test.ts', '**/*.spec.ts', '**/vitest.config.ts', '**/vitest.e2e.config.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Fastify inject / fetch responses are typed as `any`; asserting on their
      // shapes in tests is idiomatic and needs no runtime schemas.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // Test helpers parse/assert untrusted shapes directly, and vitest config
      // files must default-export their defineConfig.
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
    },
  },
);
