// scripts/discovery/types.ts
// Re-export from @faka/schema (PATTERNS §5.2 — MOVE don't copy).
// The discovery script keeps working; production schema is the single
// source of truth.

export type {
  CanonicalProduct,
  Channel,
  MatchMethod,
  MappingProfile,
} from '@faka/schema';

// Match results are discovery-only (no production analog needed).
// They describe the in-script cascade output for the matching report.

export interface MatchResult {
  anchor: import('@faka/schema').CanonicalProduct;
  candidate: import('@faka/schema').CanonicalProduct;
  method: import('@faka/schema').MatchMethod;
  score: number;
  rationale?: string;
}

export interface DiscoveryConfig {
  inputDir: string;
  outputDir: string;
  profilesDir: string;
  anchorChannel: import('@faka/schema').Channel;
  enableEmbeddings: boolean;
  enableLLMArbiter: boolean;
  embeddingThresholdHigh: number;
  embeddingThresholdMid: number;
  llmProvider: 'openai' | 'anthropic';
  llmModelName: string;
  maxLLMCalls: number;
}

export interface DiscoveryReport {
  generated_at: string;
  config: Pick<
    DiscoveryConfig,
    'anchorChannel' | 'embeddingThresholdHigh' | 'embeddingThresholdMid' | 'llmProvider' | 'llmModelName'
  >;
  inputs: Array<{ channel: import('@faka/schema').Channel; file: string; row_count: number }>;
  totals_by_channel: Record<string, number>;
  matches_by_method: Record<import('@faka/schema').MatchMethod, number>;
  match_rate_automatic: number;
  match_rate_review_needed: number;
  unresolved_samples: Array<{ anchor: string; candidates: string[] }>;
  hard_cases_for_llm: number;
  llm_calls_made: number;
  llm_cost_estimate_usd: number;
  recommendation: {
    starting_llm: string;
    rationale: string;
    expected_validation_queue: number;
  };
}
