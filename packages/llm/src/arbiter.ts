import type {
  AnchorProduct,
  ArbiterDecision,
  CandidateProduct,
  ResolvedLLMConfig,
} from "./types.js";
import { ARBITER_PROMPT_V1 } from "./prompts.js";

export async function arbitrateWithLLM(
  pair: { anchor: AnchorProduct; candidate: CandidateProduct },
  cfg: ResolvedLLMConfig,
): Promise<ArbiterDecision> {
  if (cfg.provider === "none") {
    return {
      isMatch: false,
      confidence: 0,
      rationale: "LLM disabled (no provider).",
    };
  }

  const userPrompt = ARBITER_PROMPT_V1.user(pair.anchor, pair.candidate);

  try {
    const { generateText } = await import("ai");
    const model = await buildModel(cfg);

    const { text } = await generateText({
      model: model as Parameters<typeof generateText>[0]["model"],
      system: ARBITER_PROMPT_V1.system,
      prompt: userPrompt,
      temperature: 0,
    });

    const parsed = extractJSON(text);
    return {
      isMatch: Boolean(parsed.isMatch),
      confidence:
        typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    };
  } catch (err) {
    return {
      isMatch: false,
      confidence: 0,
      rationale: `LLM error (${cfg.provider}:${cfg.model}): ${(err as Error).message}`,
    };
  }
}

async function buildModel(cfg: ResolvedLLMConfig): Promise<unknown> {
  switch (cfg.provider) {
    case "gateway": {
      const { gateway } = await import("ai");
      return gateway(cfg.model);
    }
    case "anthropic": {
      const { anthropic } = await import("@ai-sdk/anthropic");
      return anthropic(cfg.model);
    }
    case "openai": {
      const { openai } = await import("@ai-sdk/openai");
      return openai(cfg.model);
    }
    case "google": {
      const { google } = await import("@ai-sdk/google");
      return google(cfg.model);
    }
    case "moonshot":
    case "compatible": {
      const { createOpenAICompatible } = await import(
        "@ai-sdk/openai-compatible"
      );
      const apiKey = process.env[cfg.apiKeyEnv];
      const baseURL = cfg.baseURL;
      if (!apiKey) throw new Error(`Missing ${cfg.apiKeyEnv}`);
      if (!baseURL)
        throw new Error(
          `Missing OPENAI_COMPATIBLE_BASE_URL for ${cfg.provider} provider`,
        );
      const provider = createOpenAICompatible({
        name: cfg.provider,
        apiKey,
        baseURL,
      });
      return provider(cfg.model);
    }
    default:
      throw new Error(`Unsupported provider: ${cfg.provider}`);
  }
}

function extractJSON(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1]! : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const m = candidate.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        // fall through
      }
    }
    return {};
  }
}
