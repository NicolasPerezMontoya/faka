/**
 * Shared ESLint base config for the faka monorepo.
 *
 * Per-package configs extend this and add framework-specific rules
 * (e.g. apps/dashboard adds eslint-config-next).
 *
 * Two custom rules enforce project-specific constraints:
 *   1. ban-any: prevents `any` slipping in (FND-01 quality bar).
 *   2. ban-public-secret-envs: prevents NEXT_PUBLIC_* env vars whose
 *      names contain SERVICE | SECRET | PRIVATE (RESEARCH §10
 *      Pitfall 5 — accidental client-side leak of service-role keys).
 *      F2 extended the deny-list with channel/provider credentials
 *      (WORDPRESS, OPENAI, MOONSHOT, ANTHROPIC, GOOGLE_GENERATIVE_AI,
 *      AI_GATEWAY). F2.1 (Plan 2.1.0.3) further extends it with
 *      MERCADOLIBRE, ML_CLIENT, ML_REDIRECT, ML_WEBHOOK so the
 *      Mercado Libre Colombia OAuth/webhook credentials cannot leak
 *      into the client bundle via a `NEXT_PUBLIC_ML_*` prefix.
 */

const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: true,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs['recommended-type-checked'].rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'no-restricted-syntax': [
        'error',
        {
          // RESEARCH §10 / Pitfall 5 — prevent SERVICE/SECRET/PRIVATE
          // env vars from being prefixed NEXT_PUBLIC_* (would expose
          // them to the client bundle). F2 extends the deny-list with
          // channel/provider credentials that must stay server-only.
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][property.name=/^NEXT_PUBLIC_.*(SERVICE|SECRET|PRIVATE|WORDPRESS|OPENAI|MOONSHOT|ANTHROPIC|GOOGLE_GENERATIVE_AI|AI_GATEWAY|MERCADOLIBRE|ML_CLIENT|ML_REDIRECT|ML_WEBHOOK).*$/]",
          message:
            'NEXT_PUBLIC_* env vars MUST NOT contain SERVICE/SECRET/PRIVATE or channel/provider credentials — those are server-side only.',
        },
        {
          selector:
            "Literal[value=/^NEXT_PUBLIC_.*(SERVICE|SECRET|PRIVATE|WORDPRESS|OPENAI|MOONSHOT|ANTHROPIC|GOOGLE_GENERATIVE_AI|AI_GATEWAY|MERCADOLIBRE|ML_CLIENT|ML_REDIRECT|ML_WEBHOOK).*$/]",
          message:
            'String literal looks like a public-prefixed secret env var name — server-side env vars must NOT have NEXT_PUBLIC_ prefix.',
        },
      ],
    },
  },
  {
    files: ['**/__tests__/**', '**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.config.{js,cjs,mjs}',
    ],
  },
];
