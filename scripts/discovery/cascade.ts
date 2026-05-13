import type { CanonicalProduct, MatchMethod, MatchResult } from "./types.js";
import { normalizeName, jaccard } from "./normalize.js";

interface ChannelIndex {
  byBarcode: Map<string, CanonicalProduct>;
  bySupplierCode: Map<string, CanonicalProduct>;
  bySku: Map<string, CanonicalProduct>;
  byNormalizedName: Map<string, CanonicalProduct>;
  all: CanonicalProduct[];
}

export function buildIndex(products: CanonicalProduct[]): ChannelIndex {
  const idx: ChannelIndex = {
    byBarcode: new Map(),
    bySupplierCode: new Map(),
    bySku: new Map(),
    byNormalizedName: new Map(),
    all: products,
  };
  for (const p of products) {
    if (p.barcode) idx.byBarcode.set(p.barcode, p);
    if (p.supplier_code)
      idx.bySupplierCode.set(p.supplier_code.toUpperCase(), p);
    if (p.sku) idx.bySku.set(p.sku.toUpperCase(), p);
    idx.byNormalizedName.set(normalizeName(p.name), p);
  }
  return idx;
}

export interface DeterministicResult {
  matched: MatchResult | null;
  jaccardCandidates: Array<{
    candidate: CanonicalProduct;
    jaccardScore: number;
  }>;
}

const JACCARD_HIGH = 0.7;
const JACCARD_MID = 0.45;
const TOP_K_CANDIDATES = 5;

export function matchDeterministic(
  anchor: CanonicalProduct,
  index: ChannelIndex,
): DeterministicResult {
  if (anchor.barcode) {
    const hit = index.byBarcode.get(anchor.barcode);
    if (hit) {
      return {
        matched: emit(anchor, hit, "barcode_exact", 1.0),
        jaccardCandidates: [],
      };
    }
  }

  if (anchor.supplier_code) {
    const hit = index.bySupplierCode.get(anchor.supplier_code.toUpperCase());
    if (hit) {
      return {
        matched: emit(anchor, hit, "supplier_code_exact", 1.0),
        jaccardCandidates: [],
      };
    }
  }

  if (anchor.sku) {
    const hit = index.bySku.get(anchor.sku.toUpperCase());
    if (hit) {
      return {
        matched: emit(anchor, hit, "sku_exact", 0.95),
        jaccardCandidates: [],
      };
    }
  }

  const norm = normalizeName(anchor.name);
  const nameHit = index.byNormalizedName.get(norm);
  if (nameHit) {
    return {
      matched: emit(anchor, nameHit, "normalized_name_exact", 0.9),
      jaccardCandidates: [],
    };
  }

  const candidates = index.all
    .map((c) => ({ candidate: c, jaccardScore: jaccard(anchor.name, c.name) }))
    .filter((x) => x.jaccardScore > 0)
    .sort((a, b) => b.jaccardScore - a.jaccardScore)
    .slice(0, TOP_K_CANDIDATES);

  if (candidates.length > 0 && candidates[0]!.jaccardScore >= JACCARD_HIGH) {
    return {
      matched: emit(
        anchor,
        candidates[0]!.candidate,
        "embeddings_high",
        candidates[0]!.jaccardScore,
        "jaccard_token_overlap",
      ),
      jaccardCandidates: candidates,
    };
  }
  if (candidates.length > 0 && candidates[0]!.jaccardScore >= JACCARD_MID) {
    return {
      matched: emit(
        anchor,
        candidates[0]!.candidate,
        "embeddings_mid",
        candidates[0]!.jaccardScore,
        "jaccard_token_overlap",
      ),
      jaccardCandidates: candidates,
    };
  }

  return { matched: null, jaccardCandidates: candidates };
}

function emit(
  anchor: CanonicalProduct,
  candidate: CanonicalProduct,
  method: MatchMethod,
  score: number,
  rationale?: string,
): MatchResult {
  return { anchor, candidate, method, score, rationale };
}
