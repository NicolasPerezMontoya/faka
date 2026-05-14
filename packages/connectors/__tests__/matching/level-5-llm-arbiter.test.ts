/**
 * Unit tests for cascade level 5 — LLM arbiter wrapper (Plan 2.2.4).
 *
 * The wrapper has three responsibilities; each is covered below:
 *   1. Degraded mode (llmConfig=null or provider='none') -> no_provider_configured
 *   2. Daily token cap reached -> daily_token_cap_reached, no SDK call
 *   3. Control characters stripped from name fields before SDK call
 *
 * `arbitrateWithLLM` from `@faka/llm` is mocked with `vi.mock` so we don't
 * stand up an actual provider; we only verify that the wrapper passes the
 * sanitized payload through and records tokens into the budget tracker.
 *
 * Source-byte note: this file builds control-character strings via
 * `String.fromCharCode(...)` instead of regex/string literals with
 * unicode escapes so the on-disk file is pure ASCII (no embedded NUL bytes).
 * Tooling (grep, file(1), code review) treats it as text rather than binary.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock `@faka/llm`'s arbitrateWithLLM BEFORE importing the unit-under-test.
const arbitrateWithLLMMock = vi.fn();
vi.mock("@faka/llm", async () => {
  const actual = await vi.importActual<typeof import("@faka/llm")>("@faka/llm");
  return {
    ...actual,
    arbitrateWithLLM: arbitrateWithLLMMock,
  };
});

// eslint-disable-next-line import/first
import {
  arbitrateCandidate,
  ESTIMATED_TOKENS_PER_ARBITRATION,
} from "../../src/matching/level-5-llm-arbiter.js";
// eslint-disable-next-line import/first
import type {
  AnchorProduct,
  CandidateProduct,
  ResolvedLLMConfig,
} from "@faka/llm";

type BudgetStub = {
  current: ReturnType<typeof vi.fn>;
  exhausted: ReturnType<typeof vi.fn>;
  record: ReturnType<typeof vi.fn>;
};

function makeBudget(exhausted = false): BudgetStub {
  return {
    current: vi.fn(async () => 0),
    exhausted: vi.fn(async () => exhausted),
    record: vi.fn(),
  };
}

const goodAnchor: AnchorProduct = {
  name: "Aceite de oliva 1L",
  brand: "Acme",
  category: "Despensa",
};
const goodCandidate: CandidateProduct = {
  name: "Aceite Oliva 1L",
  brand: "Acme",
  category: "Despensa",
  master_sku: "11111111-1111-1111-1111-111111111111",
};

const cfg: ResolvedLLMConfig = {
  provider: "anthropic",
  model: "claude-haiku-4-5-20251001",
  apiKeyEnv: "ANTHROPIC_API_KEY",
  source: "env-autodetect",
};

// Build a regex that detects control characters (U+0000..U+001F) without
// embedding any literal control byte in this source file.
const CONTROL_CHAR_REGEX = new RegExp(
  "[" + String.fromCharCode(0) + "-" + String.fromCharCode(0x1f) + "]",
);
const NUL = String.fromCharCode(0);
const TAB = String.fromCharCode(9);
const NEWLINE = String.fromCharCode(10);
const BELL = String.fromCharCode(7);

beforeEach(() => {
  arbitrateWithLLMMock.mockReset();
});

describe("arbitrateCandidate — degraded modes (no SDK call)", () => {
  it("llmConfig=null returns no_provider_configured + zero confidence", async () => {
    const budget = makeBudget();
    const verdict = await arbitrateCandidate(null, goodAnchor, goodCandidate, {
      tokenBudget: budget as never,
    });
    expect(verdict).toEqual({
      isMatch: false,
      confidence: 0,
      rationale: "no_provider_configured",
    });
    expect(arbitrateWithLLMMock).not.toHaveBeenCalled();
    expect(budget.record).not.toHaveBeenCalled();
  });

  it("provider='none' is also degraded mode", async () => {
    const budget = makeBudget();
    const noneCfg: ResolvedLLMConfig = {
      provider: "none",
      model: "",
      apiKeyEnv: "",
      source: "none",
    };
    const verdict = await arbitrateCandidate(
      noneCfg,
      goodAnchor,
      goodCandidate,
      { tokenBudget: budget as never },
    );
    expect(verdict.rationale).toBe("no_provider_configured");
    expect(arbitrateWithLLMMock).not.toHaveBeenCalled();
  });

  it("tokenBudget.exhausted=true returns daily_token_cap_reached + no SDK call", async () => {
    const budget = makeBudget(true);
    const verdict = await arbitrateCandidate(cfg, goodAnchor, goodCandidate, {
      tokenBudget: budget as never,
    });
    expect(verdict).toEqual({
      isMatch: false,
      confidence: 0,
      rationale: "daily_token_cap_reached",
    });
    expect(arbitrateWithLLMMock).not.toHaveBeenCalled();
    // Budget check happened, but no fresh-token record.
    expect(budget.exhausted).toHaveBeenCalledOnce();
    expect(budget.record).not.toHaveBeenCalled();
  });
});

describe("arbitrateCandidate — happy path delegates to @faka/llm", () => {
  it("forwards sanitized anchor+candidate and returns the verdict", async () => {
    const budget = makeBudget();
    arbitrateWithLLMMock.mockResolvedValueOnce({
      isMatch: true,
      confidence: 0.91,
      rationale: "Names match modulo whitespace",
    });

    const verdict = await arbitrateCandidate(cfg, goodAnchor, goodCandidate, {
      tokenBudget: budget as never,
    });

    expect(verdict.isMatch).toBe(true);
    expect(verdict.confidence).toBeCloseTo(0.91, 4);
    expect(arbitrateWithLLMMock).toHaveBeenCalledOnce();
    // First arg is { anchor, candidate }; second is cfg.
    const [pair, passedCfg] = arbitrateWithLLMMock.mock.calls[0]!;
    expect(pair).toEqual({ anchor: goodAnchor, candidate: goodCandidate });
    expect(passedCfg).toBe(cfg);
  });

  it("records the estimated token spend into the budget after a successful call", async () => {
    const budget = makeBudget();
    arbitrateWithLLMMock.mockResolvedValueOnce({
      isMatch: false,
      confidence: 0.4,
      rationale: "Different SKU",
    });

    await arbitrateCandidate(cfg, goodAnchor, goodCandidate, {
      tokenBudget: budget as never,
    });
    expect(budget.record).toHaveBeenCalledOnce();
    expect(budget.record).toHaveBeenCalledWith(ESTIMATED_TOKENS_PER_ARBITRATION);
  });

  it("does NOT throw when arbitrateWithLLM throws — returns llm_error verdict", async () => {
    const budget = makeBudget();
    arbitrateWithLLMMock.mockRejectedValueOnce(new Error("boom"));

    const verdict = await arbitrateCandidate(cfg, goodAnchor, goodCandidate, {
      tokenBudget: budget as never,
    });
    expect(verdict.isMatch).toBe(false);
    expect(verdict.confidence).toBe(0);
    expect(verdict.rationale).toMatch(/^llm_error: boom/);
    // Token not recorded on error (no successful call).
    expect(budget.record).not.toHaveBeenCalled();
  });
});

describe("arbitrateCandidate — prompt injection mitigation", () => {
  it("strips ASCII control characters from anchor.name and candidate.name before sending", async () => {
    const budget = makeBudget();
    arbitrateWithLLMMock.mockResolvedValueOnce({
      isMatch: true,
      confidence: 0.85,
      rationale: "ok",
    });

    // Names with NUL + newline + tab + bell embedded — built via
    // String.fromCharCode so the source file stays pure ASCII.
    const dirtyAnchor: AnchorProduct = {
      name: "Acei" + NUL + "te" + NEWLINE + "de" + TAB + "oliva 1L",
    };
    const dirtyCandidate: CandidateProduct = {
      name: "Aceite" + BELL + "Oliva 1L",
    };

    await arbitrateCandidate(cfg, dirtyAnchor, dirtyCandidate, {
      tokenBudget: budget as never,
    });

    const [pair] = arbitrateWithLLMMock.mock.calls[0]! as [
      { anchor: AnchorProduct; candidate: CandidateProduct },
      ResolvedLLMConfig,
    ];
    // Each control byte becomes a single space.
    expect(pair.anchor.name).toBe("Acei te de oliva 1L");
    expect(pair.candidate.name).toBe("Aceite Oliva 1L");
    // No raw control byte should reach the SDK boundary.
    expect(pair.anchor.name).not.toMatch(CONTROL_CHAR_REGEX);
    expect(pair.candidate.name).not.toMatch(CONTROL_CHAR_REGEX);
  });

  it("leaves brand/category untouched (spec narrows strip to `name`)", async () => {
    const budget = makeBudget();
    arbitrateWithLLMMock.mockResolvedValueOnce({
      isMatch: true,
      confidence: 0.9,
      rationale: "ok",
    });

    const dirtyBrand = "Ac" + NUL + "me";
    const dirtyCategory = "Desp" + TAB + "ensa";

    const anchor: AnchorProduct = {
      name: "clean",
      brand: dirtyBrand,
      category: dirtyCategory,
    };
    const candidate: CandidateProduct = { name: "clean" };

    await arbitrateCandidate(cfg, anchor, candidate, {
      tokenBudget: budget as never,
    });
    const [pair] = arbitrateWithLLMMock.mock.calls[0]! as [
      { anchor: AnchorProduct; candidate: CandidateProduct },
      ResolvedLLMConfig,
    ];
    // brand/category pass through unmodified per spec.
    expect(pair.anchor.brand).toBe(dirtyBrand);
    expect(pair.anchor.category).toBe(dirtyCategory);
  });
});
