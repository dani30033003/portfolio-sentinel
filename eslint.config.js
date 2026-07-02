import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['node_modules', 'dist', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // CLAUDE.md style rule: no `any` without an explanatory eslint-disable comment.
      '@typescript-eslint/no-explicit-any': 'error',
      // Convention: a leading underscore marks a deliberately unused parameter
      // (e.g. stub signatures for human-owned modules).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
