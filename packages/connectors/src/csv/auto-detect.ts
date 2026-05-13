/**
 * Auto-detect column mappings from a freshly-uploaded CSV by fuzzy-matching
 * its header row against the channel's existing `csv_mapping_profiles`.
 *
 * Used by the wizard step 2 (apps/dashboard) to pre-populate the mapping
 * UI so the user only confirms/edits a few cells.
 *
 * F1: confidence is heuristic-based (exact + token-overlap). F4+ may swap
 * in embeddings; the API is stable.
 */

import { normalizeName } from "@faka/schema";
import type { Channel, MappingProfile } from "@faka/schema";

export type Confidence = "high" | "mid" | "none";

export interface AutoDetectSuggestion {
  field: string;
  sourceColumn: string | null;
  confidence: Confidence;
  fromProfileId?: string;
}

/**
 * Suggest a mapping by comparing the upload's header columns against the
 * column_map values from existing profiles for the channel.
 *
 * Strategy:
 *   1. For each canonical `field` we know exists for the channel/type,
 *      try to find a header whose normalized name matches the historic
 *      column name from any active profile → confidence 'high'.
 *   2. Failing that, look for a header whose normalized tokens overlap
 *      ≥2 tokens with the canonical field name → confidence 'mid'.
 *   3. Otherwise: sourceColumn=null, confidence='none' (user must map manually).
 */
export function autoDetect(
  uploadHeaders: string[],
  channel: Channel,
  existingProfiles: Array<
    Pick<MappingProfile, "channel" | "column_map"> & {
      id?: string;
      is_active?: boolean;
    }
  >,
): AutoDetectSuggestion[] {
  const activeForChannel = existingProfiles.filter(
    (p) => p.channel === channel && (p.is_active ?? true),
  );

  const canonicalFields = new Set<string>();
  for (const profile of activeForChannel) {
    for (const field of Object.keys(profile.column_map)) {
      canonicalFields.add(field);
    }
  }

  const headerNormalized = uploadHeaders.map((h) => ({
    raw: h,
    norm: normalizeName(h),
  }));

  const suggestions: AutoDetectSuggestion[] = [];

  for (const field of canonicalFields) {
    // Step 1: exact-normalized match against historic column_map values.
    let match: { sourceColumn: string; fromProfileId?: string } | null = null;
    for (const profile of activeForChannel) {
      const historicCol = profile.column_map[field];
      if (!historicCol) continue;
      const histNorm = normalizeName(historicCol);
      const hit = headerNormalized.find((h) => h.norm === histNorm);
      if (hit) {
        match = { sourceColumn: hit.raw, fromProfileId: profile.id };
        break;
      }
    }
    if (match) {
      suggestions.push({
        field,
        sourceColumn: match.sourceColumn,
        confidence: "high",
        fromProfileId: match.fromProfileId,
      });
      continue;
    }

    // Step 2: token overlap heuristic — field name vs header tokens.
    const fieldTokens = new Set(
      normalizeName(field)
        .split(" ")
        .filter((t) => t.length >= 2),
    );
    let bestHeader: string | null = null;
    let bestOverlap = 0;
    for (const h of headerNormalized) {
      const hTokens = new Set(h.norm.split(" ").filter((t) => t.length >= 2));
      let overlap = 0;
      for (const t of fieldTokens) if (hTokens.has(t)) overlap++;
      if (overlap >= 2 && overlap > bestOverlap) {
        bestOverlap = overlap;
        bestHeader = h.raw;
      }
    }
    suggestions.push({
      field,
      sourceColumn: bestHeader,
      confidence: bestHeader ? "mid" : "none",
    });
  }

  return suggestions;
}
