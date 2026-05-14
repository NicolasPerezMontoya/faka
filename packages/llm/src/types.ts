export type LLMProvider =
  | "gateway"
  | "anthropic"
  | "openai"
  | "google"
  | "moonshot"
  | "compatible"
  | "none";

export interface ResolvedLLMConfig {
  provider: LLMProvider;
  model: string;
  baseURL?: string;
  apiKeyEnv: string;
  source: "cli" | "env-explicit" | "env-autodetect" | "none";
}

export interface AnchorProduct {
  name: string;
  brand?: string;
  category?: string;
  barcode?: string;
  supplier_code?: string;
  price?: number;
  channel?: string;
}

export interface CandidateProduct {
  master_sku?: string;
  name: string;
  brand?: string;
  category?: string;
  price?: number;
  channel?: string;
}

export interface ArbiterDecision {
  isMatch: boolean;
  confidence: number;
  rationale: string;
}
