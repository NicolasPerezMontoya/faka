/**
 * Cascade level 5 — LLM arbiter (Plan 2.2.4).
 *
 * THIN wrapper around `@faka/llm`'s `arbitrateWithLLM`. Adds three things on
 * top of the underlying SDK call:
 *
 *   1. **Degraded mode** — `llmConfig === null` (no provider key) returns a
 *      no-match verdict with rationale `"no_provider_configured"`. The
 *      cascade orchestrator treats this as "level 5 produced no signal" and
 *      falls through to the validation queue.
 *   2. **Token budget guard** (RESEARCH section Pitfall 7 — LLM cost runaway):
 *      when the daily cap is reached, short-circuits with rationale
 *      `"daily_token_cap_reached"`.
 *   3. **Prompt-injection mitigation** (RESEARCH section Security): strips
 *      control characters from `anchor.name` and `candidate.name` before
 *      sending so a hostile product name can't smuggle a system-prompt
 *      override.
 *
 * Anti-duplication invariant (Plan 2.2.4 — anti-duplication note): this file
 * MUST NOT import a direct provider SDK (the `@ai-sdk` family of packages) —
 * provider routing lives in `@faka/llm/arbiter.ts` alone. Grep gate:
 *   - `grep -c 'from "@faka/llm"'` returns >= 1
 *   - `grep -c 'ai-sdk'`           returns 0
 *
 * Error behavior: never throws. Underlying SDK errors are caught and returned
 * as a no-match verdict with rationale `"llm_error: <message>"` so the
 * cascade orchestrator (Plan 2.2.5) can decide what to do.
 */

import {
  arbitrateWithLLM,
  estimateCallCost,
  type AnchorProduct,
  type CandidateProduct,
  type ResolvedLLMConfig,
  type ArbiterDecision,
} from "@faka/llm";
import type { TokenBudgetTracker } from "./token-budget.js";

/**
 * The cascade-side alias for `@faka/llm`'s `ArbiterDecision`. The plan
 * documents the wrapper as returning a `MatchVerdict` — same shape, named
 * for the cascade's vocabulary so callers don't import LLM types directly.
 */
export type MatchVerdict = ArbiterDecision;

/**
 * Control-character strip — RESEARCH section Security (prompt injection
 * mitigation). Spec from the plan: strip code points U+0000..U+001F from
 * product name fields before forwarding to the LLM.
 *
 * Implementation note: the regex is built via `String.fromCharCode` rather
 * than a regex literal containing unicode escapes so that the source file
 * stays pure-ASCII on disk (no NUL bytes embedded in source — keeps `grep`,
 * `file(1)`, code review and version-control diff tooling happy).
 *
 * Whitespace-replacement (not deletion) preserves token boundaries; deleting
 * would let an attacker glue "delete:" to a following character to forge a
 * directive in the system prompt.
 */
const CONTROL_CHAR_REGEX = new RegExp(
  "[" + String.fromCharCode(0) + "-" + String.fromCharCode(0x1f) + "]",
  "g",
);
function stripControlChars(s: string): string {
  return s.replace(CONTROL_CHAR_REGEX, " ");
}

function sanitizeAnchor(a: AnchorProduct): AnchorProduct {
  return { ...a, name: stripControlChars(a.name) };
}

function sanitizeCandidate(c: CandidateProduct): CandidateProduct {
  return { ...c, name: stripControlChars(c.name) };
}

/**
 * Run the level-5 LLM arbiter for a single anchor/candidate pair.
 *
 * @param llmConfig   resolved provider+model config, or `null` when no
 *                    provider is configured (degraded mode).
 * @param anchor      the inbound channel product (the thing we're matching).
 * @param candidate   the proposed master product (forwarded from level 4).
 * @param opts.tokenBudget  daily-cost ledger; arbiter records its consumed
 *                    tokens here so the orchestrator can flush them to
 *                    `connector_runs.metadata_json.llm_tokens` at run-end.
 */
export async function arbitrateCandidate(
  llmConfig: ResolvedLLMConfig | null,
  anchor: AnchorProduct,
  candidate: CandidateProduct,
  opts: { tokenBudget: TokenBudgetTracker },
): Promise<MatchVerdict> {
  // (1) Degraded mode — no provider configured.
  if (llmConfig === null || llmConfig.provider === "none") {
    return {
      isMatch: false,
      confidence: 0,
      rationale: "no_provider_configured",
    };
  }

  // (2) Token budget guard — short-circuit when daily cap reached.
  if (await opts.tokenBudget.exhausted()) {
    return {
      isMatch: false,
      confidence: 0,
      rationale: "daily_token_cap_reached",
    };
  }

  // (3) Prompt-injection mitigation — strip control chars from names BEFORE
  // forwarding to the SDK. Other free-text fields (brand, category) flow
  // through unchanged; the spec narrows the strip to `name`.
  const sanitizedAnchor = sanitizeAnchor(anchor);
  const sanitizedCandidate = sanitizeCandidate(candidate);

  // (4) Delegate to `@faka/llm`. Errors come back as a verdict, never throw.
  let verdict: ArbiterDecision;
  try {
    verdict = await arbitrateWithLLM(
      { anchor: sanitizedAnchor, candidate: sanitizedCandidate },
      llmConfig,
    );
  } catch (err) {
    // Defensive — `arbitrateWithLLM` already catches its own errors and
    // returns a verdict, but we keep this guard so a hypothetical bug
    // upstream doesn't break the cascade.
    return {
      isMatch: false,
      confidence: 0,
      rationale: `llm_error: ${(err as Error).message}`,
    };
  }

  // (5) Record token spend. The AI SDK call doesn't surface native usage
  // back to us through `arbitrateWithLLM`, so we estimate per
  // `@faka/llm.estimateCallCost`-style assumptions: TOKENS_IN (~250) +
  // TOKENS_OUT (~80) = ~330 tokens per call (RESEARCH section Pitfall 7).
  opts.tokenBudget.record(ESTIMATED_TOKENS_PER_ARBITRATION);

  // Keep the cost figure reachable for callers that want to log it
  // alongside the verdict; we don't return it through the verdict to keep
  // the public type stable. The orchestrator can call `estimateCallCost`
  // directly when logging.
  void estimateCallCost(1, llmConfig);

  return verdict;
}

/**
 * Estimated tokens per arbitration call. Mirrors the constants in
 * `@faka/llm.estimateCallCost` (TOKENS_IN=250 + TOKENS_OUT=80). Exported so
 * tests can assert exact recorded amounts without depending on the LLM SDK.
 */
export const ESTIMATED_TOKENS_PER_ARBITRATION = 330;
