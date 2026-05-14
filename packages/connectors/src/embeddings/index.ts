/**
 * Embeddings public surface (Plan 2.2.3 barrel).
 *
 * Single import path for the re-embedding service and the level-4 matcher.
 * The cron entries in Plan 2.3.4 (`reembed-products`) and the cascade
 * orchestrator in Plan 2.2.5 both consume this barrel — keep the surface
 * minimal so we can refactor `service.ts` internals without churning
 * downstream imports.
 */

export {
  generateEmbeddingsForProducts,
  type ReembedSummary,
  type ReembedOptions,
} from "./service.js";
export {
  matchByEmbedding,
  type EmbeddingsClient,
  type EmbeddingMatchResult,
} from "../matching/level-4-embeddings.js";
