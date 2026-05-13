import { z } from 'zod';

/**
 * Match methods for the cascade. Mirrors the `match_method` Postgres enum
 * from migration 0002 and the discovery script's `MatchMethod` type.
 *
 * F1 publishes the enum; the cascade implementation itself is F2 work
 * (PATTERNS §5.5).
 */
export const MatchMethodSchema = z.enum([
  'barcode_exact',
  'supplier_code_exact',
  'sku_exact',
  'normalized_name_exact',
  'embeddings_high',
  'embeddings_mid',
  'llm_arbiter_match',
  'llm_arbiter_reject',
  'unresolved',
]);

export type MatchMethod = z.infer<typeof MatchMethodSchema>;
