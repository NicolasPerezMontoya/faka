/**
 * Column-map application — the SINGLE owner of `Record<string,string>` →
 * canonical field projection (W1 fix). Called only from the CSVConnector
 * (`ingestUpload`); the Server Action that uploads the file
 * (`commitUpload`) writes raw rows AS-IS and does NOT invoke applyColumnMap.
 *
 * `get()` and `num()` are ported verbatim from
 * `scripts/discovery/load-csv.ts:27-39` (PATTERNS §5 — same helpers,
 * single source of truth for parsing semantics).
 */

import type { MappingProfile } from "@faka/schema";

/** Read a column from a raw row, treating empty/whitespace as undefined. */
export function get(
  row: Record<string, string>,
  sourceCol: string | undefined,
): string | undefined {
  if (!sourceCol) return undefined;
  const v = row[sourceCol];
  if (v === undefined || v === null) return undefined;
  const trimmed = String(v).trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Parse a numeric string (handles comma decimals). Returns undefined when not finite. */
export function num(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v.replace(/,/g, "."));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Apply a mapping_profile.column_map_json to a single raw row.
 *
 * Returns an object keyed by canonical field name; missing source columns
 * yield undefined values. Numeric canonical fields go through `num()`;
 * everything else stays as the trimmed string. The CSVConnector then
 * passes this object through the appropriate Zod schema (NormalizedOrder
 * or NormalizedProduct) which finalizes type coercion and validation.
 */
export function applyColumnMap(
  row: Record<string, string>,
  profile: Pick<MappingProfile, "column_map">,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const numericCanonicalFields = new Set([
    "price",
    "cost",
    "sale_price",
    "subtotal",
    "discount",
    "shipping_cost",
    "commission",
    "tax",
    "total",
    "quantity",
    "unit_price",
    "unit_cost",
    "line_discount",
    "line_total",
    "stock",
  ]);

  for (const [canonicalField, sourceCol] of Object.entries(
    profile.column_map,
  )) {
    const raw = get(row, sourceCol);
    if (raw === undefined) continue;
    out[canonicalField] = numericCanonicalFields.has(canonicalField)
      ? num(raw)
      : raw;
  }

  return out;
}
