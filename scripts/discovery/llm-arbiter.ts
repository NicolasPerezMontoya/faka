import type { CanonicalProduct, MatchResult } from './types.js';

export type LLMProvider = 'gateway' | 'anthropic' | 'openai' | 'google' | 'moonshot' | 'compatible' | 'none';

export interface ResolvedLLMConfig {
  provider: LLMProvider;
  model: string;
  baseURL?: string;
  apiKeyEnv: string;
  source: 'cli' | 'env-explicit' | 'env-autodetect' | 'none';
}

export interface ArbiterDecision {
  isMatch: boolean;
  confidence: number;
  rationale: string;
}

const DEFAULT_MODELS: Record<Exclude<LLMProvider, 'none'>, string> = {
  gateway: 'anthropic/claude-haiku-4-5',
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
  google: 'gemini-2.5-flash',
  moonshot: 'kimi-k2-0905-preview',
  compatible: 'kimi-k2-0905-preview',
};

const ENV_VAR_BY_PROVIDER: Record<Exclude<LLMProvider, 'none'>, string> = {
  gateway: 'AI_GATEWAY_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  moonshot: 'MOONSHOT_API_KEY',
  compatible: 'OPENAI_COMPATIBLE_API_KEY',
};

const AUTODETECT_ORDER: Exclude<LLMProvider, 'none'>[] = [
  'gateway', 'anthropic', 'openai', 'google', 'moonshot', 'compatible',
];

export function resolveLLMConfig(args: {
  cliProvider?: LLMProvider;
  cliModel?: string;
}): ResolvedLLMConfig {
  if (args.cliProvider && args.cliProvider !== 'none') {
    return finalize(args.cliProvider, args.cliModel, 'cli');
  }

  const envProvider = (process.env.LLM_PROVIDER || '').trim().toLowerCase() as LLMProvider;
  const envModel = (process.env.LLM_MODEL || '').trim();
  if (isValidProvider(envProvider)) {
    return finalize(envProvider, envModel || undefined, 'env-explicit');
  }

  for (const provider of AUTODETECT_ORDER) {
    if (process.env[ENV_VAR_BY_PROVIDER[provider]]) {
      return finalize(provider, undefined, 'env-autodetect');
    }
  }

  return { provider: 'none', model: '', apiKeyEnv: '', source: 'none' };
}

function isValidProvider(p: string): p is Exclude<LLMProvider, 'none'> {
  return p in DEFAULT_MODELS;
}

function finalize(
  provider: Exclude<LLMProvider, 'none'>,
  modelOverride: string | undefined,
  source: ResolvedLLMConfig['source']
): ResolvedLLMConfig {
  const model = modelOverride || DEFAULT_MODELS[provider];
  const apiKeyEnv = ENV_VAR_BY_PROVIDER[provider];

  let baseURL: string | undefined;
  if (provider === 'moonshot') {
    baseURL = 'https://api.moonshot.ai/v1';
  } else if (provider === 'compatible') {
    baseURL = process.env.OPENAI_COMPATIBLE_BASE_URL || undefined;
  }

  return { provider, model, baseURL, apiKeyEnv, source };
}

const SYSTEM_PROMPT = `Eres un experto en catálogos de productos de retail en Colombia.
Tu tarea: decidir si dos descripciones de producto se refieren al MISMO producto físico
(ignorando diferencias de formato, mayúsculas, acentos, marcas redundantes y atributos
de listado como "envío gratis" o "garantía").

Responde SIEMPRE en JSON estricto con tres campos:
- "isMatch": boolean
- "confidence": float 0-1
- "rationale": string (1-2 frases, en español, conciso)

NO incluyas texto fuera del JSON.`;

function buildUserPrompt(a: CanonicalProduct, b: CanonicalProduct): string {
  return `Producto A (canal: ${a.channel}):
  Nombre: ${a.name}
  Marca: ${a.brand ?? '(sin marca)'}
  Categoría: ${a.category ?? '(sin categoría)'}
  Precio: ${a.price ?? '(sin precio)'} COP

Producto B (canal: ${b.channel}):
  Nombre: ${b.name}
  Marca: ${b.brand ?? '(sin marca)'}
  Categoría: ${b.category ?? '(sin categoría)'}
  Precio: ${b.price ?? '(sin precio)'} COP

¿Son el mismo producto físico?`;
}

export async function arbitrateWithLLM(
  candidate: { anchor: CanonicalProduct; candidate: CanonicalProduct },
  cfg: ResolvedLLMConfig
): Promise<ArbiterDecision> {
  if (cfg.provider === 'none') {
    return { isMatch: false, confidence: 0, rationale: 'LLM disabled (no provider).' };
  }

  const userPrompt = buildUserPrompt(candidate.anchor, candidate.candidate);

  try {
    const { generateText } = await import('ai');
    const model = await buildModel(cfg);

    const { text } = await generateText({
      model: model as Parameters<typeof generateText>[0]['model'],
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0,
    });

    const parsed = extractJSON(text);
    return {
      isMatch: Boolean(parsed.isMatch),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
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
    case 'gateway': {
      const { gateway } = await import('ai');
      return gateway(cfg.model);
    }
    case 'anthropic': {
      const { anthropic } = await import('@ai-sdk/anthropic');
      return anthropic(cfg.model);
    }
    case 'openai': {
      const { openai } = await import('@ai-sdk/openai');
      return openai(cfg.model);
    }
    case 'google': {
      const { google } = await import('@ai-sdk/google');
      return google(cfg.model);
    }
    case 'moonshot':
    case 'compatible': {
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
      const apiKey = process.env[cfg.apiKeyEnv];
      const baseURL = cfg.baseURL;
      if (!apiKey) throw new Error(`Missing ${cfg.apiKeyEnv}`);
      if (!baseURL) throw new Error(`Missing OPENAI_COMPATIBLE_BASE_URL for ${cfg.provider} provider`);
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
      } catch {}
    }
    return {};
  }
}

export function promoteToMatch(
  pre: { anchor: CanonicalProduct; candidate: CanonicalProduct },
  decision: ArbiterDecision
): MatchResult {
  return {
    anchor: pre.anchor,
    candidate: pre.candidate,
    method: decision.isMatch ? 'llm_arbiter_match' : 'llm_arbiter_reject',
    score: decision.confidence,
    rationale: decision.rationale,
  };
}

export function summarizeConfig(cfg: ResolvedLLMConfig): string {
  if (cfg.provider === 'none') {
    return 'no provider configured (set LLM_PROVIDER or an API key in .env)';
  }
  const keyState = process.env[cfg.apiKeyEnv] ? 'set' : 'MISSING';
  const base = cfg.baseURL ? ` @ ${cfg.baseURL}` : '';
  return `${cfg.provider}:${cfg.model}${base} [${cfg.apiKeyEnv}=${keyState}, source=${cfg.source}]`;
}

export function estimateCallCost(calls: number, cfg: ResolvedLLMConfig): number {
  const TOKENS_IN = 250;
  const TOKENS_OUT = 80;
  const PRICING: Record<string, { in: number; out: number }> = {
    'claude-haiku-4-5-20251001': { in: 1.0, out: 5.0 },
    'claude-haiku-4-5': { in: 1.0, out: 5.0 },
    'anthropic/claude-haiku-4-5': { in: 1.0, out: 5.0 },
    'gpt-4o-mini': { in: 0.15, out: 0.6 },
    'openai/gpt-4o-mini': { in: 0.15, out: 0.6 },
    'gemini-2.5-flash': { in: 0.075, out: 0.3 },
    'google/gemini-2.5-flash': { in: 0.075, out: 0.3 },
    'kimi-k2-0905-preview': { in: 0.6, out: 2.5 },
  };
  const p = PRICING[cfg.model] ?? { in: 1.0, out: 5.0 };
  return (calls * TOKENS_IN * p.in + calls * TOKENS_OUT * p.out) / 1_000_000;
}
