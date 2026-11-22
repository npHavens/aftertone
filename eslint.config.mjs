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
    // Prettier removes extra blank lines but never adds them. This requires one after the
    // imports, before a return, and around interfaces and multi-line const, let, export and
    // type declarations, expression statements and braced blocks. Runs of one-line statements
    // stay together. A brace-less if or a throw that Prettier wraps isn't matched.
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: 'import', next: '*' },
        { blankLine: 'any', prev: 'import', next: 'import' },
        {
          blankLine: 'always',
          prev: '*',
          next: [
            'multiline-const',
            'multiline-let',
            'multiline-expression',
            'multiline-block-like',
            'multiline-export',
            'multiline-type',
            'interface',
          ],
        },
        {
          blankLine: 'always',
          prev: [
            'multiline-const',
            'multiline-let',
            'multiline-expression',
            'multiline-block-like',
            'multiline-export',
            'multiline-type',
            'interface',
          ],
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
