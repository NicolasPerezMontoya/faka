# @faka/connectors — Changelog

All notable changes to the `@faka/connectors` workspace package.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
the project uses an evergreen-trunk model so versions are advisory.

## Unreleased

### Added

- **Phase 2.1 / Wave 0 / Plan 2.1.0.1** — pinned `undici@8.2.0` as the
  Node-native HTTP transport for the Mercado Libre Colombia connector
  (REST + OAuth endpoints). `undici` is the single canonical HTTP client
  for the ML connector; existing F1/F2 code continues to use the global
  `fetch` (which is `undici` under the hood). Anti-duplication: no
  second HTTP client (`axios`, `node-fetch`) — see PATTERNS §"Retry +
  DLQ" REUSED-from-F1 invariant. `p-retry` stays pinned at `^7` —
  the F1 `withRetryAndDLQ` wrapper at `src/retry.ts` is API-stable
  against v7 and the v8 bump would force lockfile churn for zero gain.
  `msw@^2.7.0` already present from F2 Wave 0 (used for ML wave-4
  unit tests).
