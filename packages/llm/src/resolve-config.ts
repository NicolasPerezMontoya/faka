import type { LLMProvider, ResolvedLLMConfig } from "./types.js";

const DEFAULT_MODELS: Record<Exclude<LLMProvider, "none">, string> = {
  gateway: "anthropic/claude-haiku-4-5",
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  google: "gemini-2.5-flash",
  moonshot: "kimi-k2-0905-preview",
  compatible: "kimi-k2-0905-preview",
};

const ENV_VAR_BY_PROVIDER: Record<Exclude<LLMProvider, "none">, string> = {
  gateway: "AI_GATEWAY_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  compatible: "OPENAI_COMPATIBLE_API_KEY",
};

// Autodetect order: AI Gateway → Anthropic → OpenAI → Google → Moonshot → compatible.
// Whichever provider's API key env var is set first wins.
const AUTODETECT_ORDER: Exclude<LLMProvider, "none">[] = [
  "gateway",
  "anthropic",
  "openai",
  "google",
  "moonshot",
  "compatible",
];

export function resolveLLMConfig(args: {
  cliProvider?: LLMProvider;
  cliModel?: string;
  env?: NodeJS.ProcessEnv;
}): ResolvedLLMConfig {
  const env = args.env ?? process.env;

  if (args.cliProvider && args.cliProvider !== "none") {
    return finalize(args.cliProvider, args.cliModel, "cli");
  }

  const envProvider = (env.LLM_PROVIDER || "")
    .trim()
    .toLowerCase() as LLMProvider;
  const envModel = (env.LLM_MODEL || "").trim();
  if (isValidProvider(envProvider)) {
    return finalize(envProvider, envModel || undefined, "env-explicit", env);
  }

  for (const provider of AUTODETECT_ORDER) {
    if (env[ENV_VAR_BY_PROVIDER[provider]]) {
      return finalize(provider, undefined, "env-autodetect", env);
    }
  }

  return { provider: "none", model: "", apiKeyEnv: "", source: "none" };
}

function isValidProvider(p: string): p is Exclude<LLMProvider, "none"> {
  return p in DEFAULT_MODELS;
}

function finalize(
  provider: Exclude<LLMProvider, "none">,
  modelOverride: string | undefined,
  source: ResolvedLLMConfig["source"],
  env: NodeJS.ProcessEnv = process.env,
): ResolvedLLMConfig {
  const model = modelOverride || DEFAULT_MODELS[provider];
  const apiKeyEnv = ENV_VAR_BY_PROVIDER[provider];

  let baseURL: string | undefined;
  if (provider === "moonshot") {
    baseURL = "https://api.moonshot.ai/v1";
  } else if (provider === "compatible") {
    baseURL = env.OPENAI_COMPATIBLE_BASE_URL || undefined;
  }

  return { provider, model, baseURL, apiKeyEnv, source };
}

export function summarizeConfig(cfg: ResolvedLLMConfig): string {
  if (cfg.provider === "none") {
    return "no provider configured (set LLM_PROVIDER or an API key in .env)";
  }
  const keyState = process.env[cfg.apiKeyEnv] ? "set" : "MISSING";
  const base = cfg.baseURL ? ` @ ${cfg.baseURL}` : "";
  return `${cfg.provider}:${cfg.model}${base} [${cfg.apiKeyEnv}=${keyState}, source=${cfg.source}]`;
}

export function estimateCallCost(
  calls: number,
  cfg: ResolvedLLMConfig,
): number {
  const TOKENS_IN = 250;
  const TOKENS_OUT = 80;
  const PRICING: Record<string, { in: number; out: number }> = {
    "claude-haiku-4-5-20251001": { in: 1.0, out: 5.0 },
    "claude-haiku-4-5": { in: 1.0, out: 5.0 },
    "anthropic/claude-haiku-4-5": { in: 1.0, out: 5.0 },
    "gpt-4o-mini": { in: 0.15, out: 0.6 },
    "openai/gpt-4o-mini": { in: 0.15, out: 0.6 },
    "gemini-2.5-flash": { in: 0.075, out: 0.3 },
    "google/gemini-2.5-flash": { in: 0.075, out: 0.3 },
    "kimi-k2-0905-preview": { in: 0.6, out: 2.5 },
  };
  const p = PRICING[cfg.model] ?? { in: 1.0, out: 5.0 };
  return (
    (calls * TOKENS_IN * p.in + calls * TOKENS_OUT * p.out) / 1_000_000
  );
}
