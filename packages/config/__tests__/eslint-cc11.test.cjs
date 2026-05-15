/**
 * CC-11 regex fixture test (F2.1 Plan 2.1.0.3).
 *
 * The `packages/config` workspace has no test runner; this file is a
 * pure-node assertion script. Run with:
 *
 *   node packages/config/__tests__/eslint-cc11.test.cjs
 *
 * Exits 0 on success, 1 on any failed assertion. Wired into
 * `pnpm -r lint` indirectly via the eslint base config — the
 * regex this test asserts is the one used by the actual lint rule.
 *
 * Scope: structural assertion only. Confirms that the alternation
 * group in `eslint.base.cjs` rejects the F2.1-NEW patterns
 * (NEXT_PUBLIC_ML_CLIENT_*, NEXT_PUBLIC_MERCADOLIBRE_*, etc.) AND
 * still rejects the F2-era patterns (WORDPRESS/OPENAI/...) AND does
 * NOT false-positive on legitimate NEXT_PUBLIC_SUPABASE_* names.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const BASE_PATH = path.resolve(__dirname, '..', 'eslint.base.cjs');
const src = fs.readFileSync(BASE_PATH, 'utf8');

// Extract the canonical regex literal from the source. We pin to the
// MemberExpression selector form (the Literal form mirrors it).
const match = src.match(
  /property\.name=\/\^NEXT_PUBLIC_\.\*\(([A-Z_|]+)\)\.\*\$\/\]/,
);
assert.ok(
  match,
  'expected to find the CC-11 MemberExpression regex in eslint.base.cjs',
);

const alternation = match[1];
const tokens = alternation.split('|');

// Snapshot: every required token (F1 + F2 + F2.1) is present.
const REQUIRED_TOKENS = [
  // F1 origins.
  'SERVICE',
  'SECRET',
  'PRIVATE',
  // F2 (Plan 2.0.2) channel/provider extensions.
  'WORDPRESS',
  'OPENAI',
  'MOONSHOT',
  'ANTHROPIC',
  'GOOGLE_GENERATIVE_AI',
  'AI_GATEWAY',
  // F2.1 (Plan 2.1.0.3) — Mercado Libre Colombia.
  'MERCADOLIBRE',
  'ML_CLIENT',
  'ML_REDIRECT',
  'ML_WEBHOOK',
];
for (const tok of REQUIRED_TOKENS) {
  assert.ok(
    tokens.includes(tok),
    `CC-11 alternation must include '${tok}' (found: ${tokens.join('|')})`,
  );
}

// Reconstruct the regex and run positive + negative cases.
const cc11 = new RegExp(`^NEXT_PUBLIC_.*(${alternation}).*$`);

// Positive (MUST match — the lint rule MUST fire on these names).
const POSITIVE_CASES = [
  // F2.1 ML.
  'NEXT_PUBLIC_ML_CLIENT_ID',
  'NEXT_PUBLIC_ML_CLIENT_SECRET',
  'NEXT_PUBLIC_ML_REDIRECT_URI',
  'NEXT_PUBLIC_ML_WEBHOOK_SECRET',
  'NEXT_PUBLIC_MERCADOLIBRE_CONFIG',
  // F2 carryforward.
  'NEXT_PUBLIC_WORDPRESS_API_URL',
  'NEXT_PUBLIC_OPENAI_API_KEY',
  // F1 origin.
  'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_FOO_SECRET',
];
for (const name of POSITIVE_CASES) {
  assert.match(name, cc11, `CC-11 regex must flag '${name}' as a violation`);
}

// Negative (MUST NOT match — these are legitimate browser-safe env vars).
const NEGATIVE_CASES = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_APP_NAME',
  // Server-side names (without NEXT_PUBLIC_ prefix) — the rule SHOULD
  // not flag these at all; they're legal.
  'ML_CLIENT_ID',
  'ML_CLIENT_SECRET',
  'ML_REDIRECT_URI',
  'ML_WEBHOOK_SECRET',
  'WORDPRESS_API_URL',
];
for (const name of NEGATIVE_CASES) {
  assert.doesNotMatch(
    name,
    cc11,
    `CC-11 regex must NOT flag '${name}' (legitimate browser/server var)`,
  );
}

// eslint-disable-next-line no-console
console.log(
  `[CC-11] OK — alternation has ${tokens.length} tokens; ${POSITIVE_CASES.length} positive + ${NEGATIVE_CASES.length} negative assertions pass.`,
);
