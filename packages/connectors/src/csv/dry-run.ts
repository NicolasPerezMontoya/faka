/**
 * Dry-run a CSV upload against a mapping_profile WITHOUT writing facts.
 *
 * Returns a preview of how many rows would be valid, warning, error,
 * plus PROJECTED downstream impact (newMasterSkus, autoMatches, etc.).
 *
 * In F1 the `projected.*` fields are placeholder zeros — the matching
 * cascade (F2) wires real numbers per PATTERNS §3.C. The validation
 * counts (valid/warning/error) ARE real and useful for the wizard step 3
 * "Validate and confirm" UI.
 *
 * Called from the Server Action that powers the wizard step 3.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  NormalizedOrderSchema,
  NormalizedProductSchema,
  type MappingProfile,
} from "@faka/schema";
import { applyColumnMap } from "./column-map.js";

export interface DryRunError {
  row_number: number;
  message: string;
  field?: string;
}

export interface DryRunResult {
  rowsValid: number;
  rowsWarning: number;
  rowsError: number;
  errors: DryRunError[];
  projected: {
    newMasterSkus: number;
    autoMatches: number;
    llmCandidates: number;
    validationQueue: number;
  };
}

export interface DryRunInput {
  supabase: SupabaseClient;
  uploadId: string;
  profileId: string;
  /** Sample size to dry-run against (full file = -1). Default 500. */
  sampleSize?: number;
}

export async function dryRun(input: DryRunInput): Promise<DryRunResult> {
  const { supabase, uploadId, profileId, sampleSize = 500 } = input;

  const { data: profile, error: profileErr } = await supabase
    .from("csv_mapping_profiles")
    .select("id, canal, tipo, column_map_json")
    .eq("id", profileId)
    .single();

  if (profileErr || !profile) {
    throw new Error(`profile_not_found: ${profileErr?.message ?? profileId}`);
  }

  const mapping: MappingProfile = {
    channel: profile.canal,
    type: profile.tipo,
    column_map: profile.column_map_json as Record<string, string>,
  };

  let query = supabase
    .from("raw_csv_rows")
    .select("row_number, payload_json")
    .eq("upload_id", uploadId)
    .is("superseded_at", null)
    .order("row_number", { ascending: true });

  if (sampleSize > 0) query = query.limit(sampleSize);

  const { data: rows, error: rowsErr } = await query;
  if (rowsErr) throw new Error(`raw_csv_rows_read_failed: ${rowsErr.message}`);

  const schema =
    mapping.type === "orders" ? NormalizedOrderSchema : NormalizedProductSchema;

  let rowsValid = 0;
  let rowsWarning = 0;
  let rowsError = 0;
  const errors: DryRunError[] = [];

  for (const row of rows ?? []) {
    const raw = row.payload_json as Record<string, string>;
    const projected = applyColumnMap(raw, mapping);
    // Inject channel so the schema can validate it as a discriminator.
    (projected as Record<string, unknown>).channel = mapping.channel;
    const parsed = schema.safeParse(projected);
    if (parsed.success) {
      rowsValid++;
    } else {
      const firstIssue = parsed.error.issues[0];
      if (firstIssue) {
        rowsError++;
        errors.push({
          row_number: row.row_number,
          field: firstIssue.path.join(".") || undefined,
          message: firstIssue.message,
        });
      }
    }
  }

  return {
    rowsValid,
    rowsWarning,
    rowsError,
    errors: errors.slice(0, 50),
    projected: {
      newMasterSkus: 0,
      autoMatches: 0,
      llmCandidates: 0,
      validationQueue: 0,
    },
  };
}
