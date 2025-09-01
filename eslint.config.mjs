// ESLint v9+ flat config
// Mirrors the previous .eslintrc settings and integrates ignores here.

import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import unusedImports from 'eslint-plugin-unused-imports';

export default [
  // Global ignores should be in a separate config object
  {
    ignores: [
      'dist/**',
      'dist-app/**',
      'node_modules/**',
      'build/**',
      'resources/models/**',
      'tests/fixtures/**'
    ]
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'unused-imports': unusedImports
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      'unused-imports/no-unused-imports': 'error'
    }
  }
];

