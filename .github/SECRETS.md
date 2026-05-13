# GitHub Actions Secrets

This file documents the secrets the CI workflows expect. Configure them in
**Settings → Secrets and variables → Actions** of the repo.

## Required secrets (current)

| Secret                  | Used in              | What it is                                                                                                                                           |
| ----------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | `db-integration` job | Personal access token from supabase.com/dashboard/account/tokens. Allows `supabase` CLI to authenticate against the registry; **NOT** a project key. |

## Not yet required (added in later phases)

These will be added when the phases that need them ship. **Do NOT add them
preemptively** — keeping secrets minimal reduces blast radius if a runner is
compromised.

| Secret                              | Phase                         | Notes                                                                                                                      |
| ----------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_PROJECT_REF_STAGING`      | 1.4.4b (Vercel deploy config) | Staging project ref for branch previews.                                                                                   |
| `SUPABASE_ANON_KEY_STAGING`         | 1.4.4b                        | Anon key for staging — safe-ish to expose but kept secret to avoid abuse.                                                  |
| `SUPABASE_SERVICE_ROLE_KEY_STAGING` | 1.4.4b                        | Server-side only. **NEVER** prefix with `NEXT_PUBLIC_*` in env files.                                                      |
| `VERCEL_TOKEN`                      | 1.4.4b                        | Vercel API token for preview deploys.                                                                                      |
| `RAILWAY_TOKEN`                     | 1.4.4a                        | Railway API token for orchestrator deploys.                                                                                |
| `ANTHROPIC_API_KEY`                 | F5 (AI layer)                 | LLM provider key — only needed in CI for integration tests that exercise the arbiter. Probably skip in CI; tests can mock. |
| `META_WA_*`                         | F5.5 (WhatsApp)               | WhatsApp Business Cloud API credentials.                                                                                   |

## CI safety rules (enforced by `ci.yml`)

1. **CI never calls `supabase db push`** against a remote project. CI uses
   `supabase start` (local Docker stack) + `supabase db reset` only.
   Production migrations are applied via a separate manual workflow that
   requires environment approval.
2. **Service-role keys are never logged.** The eslint custom rule in
   `packages/config/eslint.base.cjs` blocks `NEXT_PUBLIC_*` env reads whose
   names contain `SERVICE | SECRET | PRIVATE`; any access at runtime should
   raise. `echo "$SUPABASE_SERVICE_ROLE_KEY"` in any workflow step is a
   review-blocking issue.
3. **`secrets.GITHUB_TOKEN` is read-only**. Workflows that need write access
   to the repo (e.g. dependency-update bots, label automation) use a
   dedicated PAT scoped to the minimum required.
