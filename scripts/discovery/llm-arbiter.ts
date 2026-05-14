// Discovery-script shim: the canonical LLM adapter now lives in
// `@faka/llm` (extracted in Phase 2 Plan 2.0.1). This file re-exports
// the public surface so existing imports in `match-explorer.ts`
// keep working without source changes.
//
// `promoteToMatch` stays here because it depends on `CanonicalProduct`
// + `MatchResult` from the discovery-local `./types.ts` — those types
// are intentionally outside the LLM package (which is domain-agnostic).

import type { CanonicalProduct, MatchResult } from "./types.js";
import type { ArbiterDecision } from "@faka/llm";

export {
  resolveLLMConfig,
  arbitrateWithLLM,
  summarizeConfig,
  estimateCallCost,
  ARBITER_PROMPT_V1,
} from "@faka/llm";
export type {
  LLMProvider,
  ResolvedLLMConfig,
  ArbiterDecision,
} from "@faka/llm";

export function promoteToMatch(
  pre: { anchor: CanonicalProduct; candidate: CanonicalProduct },
  decision: ArbiterDecision,
): MatchResult {
  return {
    anchor: pre.anchor,
    candidate: pre.candidate,
    method: decision.isMatch ? "llm_arbiter_match" : "llm_arbiter_reject",
    score: decision.confidence,
    rationale: decision.rationale,
  };
}
