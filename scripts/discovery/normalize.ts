// scripts/discovery/normalize.ts
// Re-export from @faka/schema/normalize so the production helpers and the
// discovery script share the same Spanish stopword list and regex chains
// (PATTERNS §5.6 — same algorithm, single source of truth).

export {
  normalizeName,
  tokens,
  contentTokens,
  jaccard,
  normalizeBarcode,
} from "@faka/schema";
