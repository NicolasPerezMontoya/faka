import type { CanonicalProduct, MatchResult } from './types.js';

export interface ArbiterDecision {
  isMatch: boolean;
  confidence: number;
  rationale: string;
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
  opts: { provider: 'openai' | 'anthropic'; model: string }
): Promise<ArbiterDecision> {
  const userPrompt = buildUserPrompt(candidate.anchor, candidate.candidate);

  try {
    const { generateText } = await import('ai');
    let model;
    if (opts.provider === 'openai') {
      const { openai } = await import('@ai-sdk/openai');
      model = openai(opts.model);
    } else {
      const { anthropic } = await import('@ai-sdk/anthropic');
      model = anthropic(opts.model);
    }

    const { text } = await generateText({
      model,
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
      rationale: `LLM error: ${(err as Error).message}`,
    };
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
