/**
 * Text normalization helpers — verbatim port of
 * `scripts/discovery/normalize.ts:1-39` (PATTERNS §5.6).
 *
 * DO NOT rewrite the regex chains or change the Spanish stopword list.
 * The cascade (F2) and the autodetect heuristics depend on these exact
 * normalizations matching the discovery-phase reference results.
 *
 * Re-exported by `scripts/discovery/normalize.ts` so the discovery script
 * picks up improvements automatically.
 */

export function normalizeName(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(input: string): string[] {
  return normalizeName(input)
    .split(" ")
    .filter((t) => t.length >= 2);
}

const STOPWORDS = new Set([
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "unos",
  "unas",
  "de",
  "del",
  "en",
  "con",
  "por",
  "para",
  "a",
  "y",
  "o",
  "pro",
  "plus",
  "premium",
  "new",
  "nueva",
  "nuevo",
  "edicion",
]);

export function contentTokens(input: string): string[] {
  return tokens(input).filter((t) => !STOPWORDS.has(t));
}

export function jaccard(a: string, b: string): number {
  const sa = new Set(contentTokens(a));
  const sb = new Set(contentTokens(b));
  if (sa.size === 0 && sb.size === 0) return 0;
  const intersection = [...sa].filter((t) => sb.has(t)).length;
  const union = new Set([...sa, ...sb]).size;
  return intersection / union;
}

export function normalizeBarcode(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8) return undefined;
  return digits;
}
