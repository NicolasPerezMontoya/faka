export type Channel = 'wordpress' | 'mercadolibre' | 'dropi' | 'pos' | 'pos1' | 'pos2' | 'whatsapp';

export interface CanonicalProduct {
  channel: Channel;
  external_id: string;
  sku?: string;
  name: string;
  description?: string;
  category?: string;
  brand?: string;
  price?: number;
  cost?: number;
  barcode?: string;
  supplier_code?: string;
  image_url?: string;
  status?: string;
  raw_row: Record<string, string>;
}

export type MatchMethod =
  | 'barcode_exact'
  | 'supplier_code_exact'
  | 'sku_exact'
  | 'normalized_name_exact'
  | 'embeddings_high'
  | 'embeddings_mid'
  | 'llm_arbiter_match'
  | 'llm_arbiter_reject'
  | 'unresolved';

export interface MatchResult {
  anchor: CanonicalProduct;
  candidate: CanonicalProduct;
  method: MatchMethod;
  score: number;
  rationale?: string;
}

export interface MappingProfile {
  channel: Channel;
  type: 'products' | 'orders' | 'order_items';
  delimiter?: string;
  column_map: Record<string, string>;
  defaults?: Record<string, string>;
}

export interface DiscoveryConfig {
  inputDir: string;
  outputDir: string;
  profilesDir: string;
  anchorChannel: Channel;
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
  config: Pick<DiscoveryConfig, 'anchorChannel' | 'embeddingThresholdHigh' | 'embeddingThresholdMid' | 'llmProvider' | 'llmModelName'>;
  inputs: Array<{ channel: Channel; file: string; row_count: number }>;
  totals_by_channel: Record<string, number>;
  matches_by_method: Record<MatchMethod, number>;
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
