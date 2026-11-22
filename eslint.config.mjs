import stylistic from '@stylistic/eslint-plugin';
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  prettier,
  {
    // Prettier removes extra blank lines but never adds them. This adds one after the imports,
    // around every multi-line statement and before a return, and leaves runs of one-line
    // statements together.
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: 'import', next: '*' },
        { blankLine: 'any', prev: 'import', next: 'import' },
        {
          blankLine: 'always',
          prev: '*',
          next: ['multiline-const', 'multiline-let', 'multiline-expression', 'block-like'],
        },
        {
          blankLine: 'always',
          prev: ['multiline-const', 'multiline-let', 'multiline-expression', 'block-like'],
          next: '*',
        },
        { blankLine: 'always', prev: '*', next: 'return' },
      ],
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'backend/**',
    'test-results/**',
    'playwright-report/**',
  ]),
]);
