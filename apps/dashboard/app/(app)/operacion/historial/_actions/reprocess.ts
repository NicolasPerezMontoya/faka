'use server';

/**
 * reprocess-upload — Run a past upload through the pipeline again with a
 * different (typically newer) mapping_profile version.
 *
 * Storage bytes are IMMUTABLE per ADR-001 — we re-download, re-parse, and
 * re-emit. The existing raw_csv_rows for this upload are marked
 * superseded_at so the audit trail stays complete; new rows reference
 * the new profile via mapping_profile_id_used (migration 0013).
 *
 * Idempotency: the (canal, external_order_id) UPSERT on sales /
 * (canal, external_id) UPSERT on product_mappings means downstream rows
 * don't duplicate even if reprocess emits the same external IDs.
 */

import { parse as parseCsvSync } from 'csv-parse/sync';
import { revalidatePath } from 'next/cache';
import { requireRole, ForbiddenError } from '@faka/auth';
import { createCSVConnector } from '@faka/connectors/csv';
import { recordConnectorRun } from '@faka/connectors';
import { auditLog } from '@faka/db';
import type { Json } from '@faka/db/types';
import { createClient } from '@/lib/supabase/server';

const CHUNK_SIZE = 500;

export interface ReprocessInput {
  uploadId: string;
  newProfileId: string;
}

export interface ReprocessResult {
  ok: boolean;
  error?: string;
  rows_processed?: number;
  rows_skipped?: number;
  reprocess_id?: string;
}

export async function reprocessUploadAction(input: ReprocessInput): Promise<ReprocessResult> {
  const supabase = createClient();

  let ctx;
  try {
    ctx = await requireRole(supabase, ['super_admin', 'admin', 'manager']);
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: 'forbidden' };
    return { ok: false, error: 'auth_failed' };
  }

  const startedAt = new Date();
  let runStatus: 'succeeded' | 'partial' | 'failed' = 'succeeded';
  let recordsProcessed = 0;
  let recordsFailed = 0;
  let errorsJson: Json | null = null;

  // History row records the reprocess event regardless of outcome.
  const { data: historyRow, error: historyErr } = await supabase
    .from('csv_reprocess_history')
    .insert({
      upload_id: input.uploadId,
      triggered_by: ctx.user.id,
      mapping_profile_id_after: input.newProfileId,
      status: 'running',
    })
    .select('id')
    .single();

  if (historyErr || !historyRow) {
    return { ok: false, error: `reprocess_history_insert_failed: ${historyErr?.message ?? 'unknown'}` };
  }
  const reprocessId = historyRow.id as string;

  try {
    // 1. Load upload + current profile.
    const { data: upload, error: uploadErr } = await supabase
      .from('raw_csv_uploads')
      .select('upload_id, canal_declarado, tipo, storage_path, mapping_profile_id')
      .eq('upload_id', input.uploadId)
      .single();
    if (uploadErr || !upload) {
      return { ok: false, error: `upload_not_found: ${uploadErr?.message ?? input.uploadId}` };
    }

    // 2. Validate new profile matches (canal, tipo).
    const { data: newProfile, error: newProfileErr } = await supabase
      .from('csv_mapping_profiles')
      .select('id, canal, tipo, version')
      .eq('id', input.newProfileId)
      .single();
    if (newProfileErr || !newProfile) {
      return { ok: false, error: 'profile_not_found' };
    }
    if (newProfile.canal !== upload.canal_declarado || newProfile.tipo !== upload.tipo) {
      return { ok: false, error: 'profile_mismatch_canal_or_tipo' };
    }

    await supabase
      .from('csv_reprocess_history')
      .update({ mapping_profile_id_before: upload.mapping_profile_id })
      .eq('id', reprocessId);

    // 3. Soft-supersede existing raw_csv_rows for this upload.
    await supabase
      .from('raw_csv_rows')
      .update({ superseded_at: new Date().toISOString() })
      .eq('upload_id', input.uploadId)
      .is('superseded_at', null);

    // 4. Update upload row to the new profile + status='validating'.
    await supabase
      .from('raw_csv_uploads')
      .update({ mapping_profile_id: input.newProfileId, status: 'validating' })
      .eq('upload_id', input.uploadId);

    // 5. Re-download bytes from Storage (immutable per ADR-001).
    const { data: bytes, error: downloadErr } = await supabase.storage
      .from('csv-uploads')
      .download(upload.storage_path);
    if (downloadErr || !bytes) {
      return { ok: false, error: `storage_download_failed: ${downloadErr?.message ?? 'no data'}` };
    }
    const text = await bytes.text();

    // 6. Parse + write NEW raw_csv_rows (still raw payload — W1 invariant).
    let rows: Array<Record<string, string>>;
    try {
      rows = parseCsvSync(text, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_quotes: true,
      }) as Array<Record<string, string>>;
    } catch (parseErr) {
      return { ok: false, error: `csv_parse_failed: ${(parseErr as Error).message}` };
    }

    // Determine starting row_number — use max(existing) + 1 to avoid the
    // unique (upload_id, row_number) constraint colliding with superseded rows.
    const { data: maxRow } = await supabase
      .from('raw_csv_rows')
      .select('row_number')
      .eq('upload_id', input.uploadId)
      .order('row_number', { ascending: false })
      .limit(1);
    const startRow = (maxRow?.[0]?.row_number ?? -1) + 1;

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const batch = rows.slice(i, i + CHUNK_SIZE).map((row, idx) => ({
        upload_id: input.uploadId,
        row_number: startRow + i + idx,
        payload_json: row,
        processed: false,
        mapping_profile_id_used: input.newProfileId,
      }));
      const { error: rowsErr } = await supabase.from('raw_csv_rows').insert(batch);
      if (rowsErr) {
        runStatus = 'failed';
        errorsJson = { phase: 'raw_csv_rows_insert', message: rowsErr.message } as Json;
        return { ok: false, error: `raw_csv_rows_insert_failed: ${rowsErr.message}` };
      }
    }

    // 7. Invoke CSVConnector — same UPSERT logic = idempotent end result.
    const connector = createCSVConnector({});
    type CSVConnectorWithIngest = typeof connector & {
      ingestUpload: (
        uploadId: string,
        ctx: { supabase: typeof supabase; logger: { debug: (m: string) => void; info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void } },
      ) => Promise<{ upload_id: string; rows_processed: number; rows_skipped: number; errors: Array<{ row_number: number; field?: string; message: string }> }>;
    };
    const ingestable = connector as CSVConnectorWithIngest;
    const ingestResult = await ingestable.ingestUpload(input.uploadId, {
      supabase,
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: console.warn,
        error: console.error,
      },
    });

    recordsProcessed = ingestResult.rows_processed;
    recordsFailed = ingestResult.rows_skipped;
    if (ingestResult.errors.length > 0) {
      errorsJson = { errors: ingestResult.errors.slice(0, 100) } as Json;
      runStatus = ingestResult.rows_processed === 0 ? 'failed' : 'partial';
    }

    // 8. Audit.
    await auditLog(supabase, {
      user_id: ctx.user.id,
      role_at_time: ctx.role,
      action: 'csv_upload_reprocessed',
      target_table: 'raw_csv_uploads',
      target_id: input.uploadId,
      payload_json: {
        from_profile: upload.mapping_profile_id,
        to_profile_id: input.newProfileId,
        to_version: newProfile.version,
        rows_processed: recordsProcessed,
        rows_skipped: recordsFailed,
      },
    });

    return { ok: true, rows_processed: recordsProcessed, rows_skipped: recordsFailed, reprocess_id: reprocessId };
  } catch (err) {
    runStatus = 'failed';
    errorsJson = { caught: (err as Error).message } as Json;
    return { ok: false, error: (err as Error).message };
  } finally {
    // Finalize history row.
    await supabase
      .from('csv_reprocess_history')
      .update({
        status: runStatus,
        rows_processed: recordsProcessed,
        rows_failed: recordsFailed,
        errors_json: errorsJson,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt.getTime(),
      })
      .eq('id', reprocessId);

    // Record connector_runs.
    try {
      await recordConnectorRun(supabase, {
        kind: 'channel',
        canal: 'csv-upload',
        started_at: startedAt.toISOString(),
        completed_at: new Date().toISOString(),
        status: runStatus,
        records_processed: recordsProcessed,
        records_failed: recordsFailed,
        retry_count: 0,
        errors_json: errorsJson,
        duration_ms: Date.now() - startedAt.getTime(),
        upload_id: input.uploadId,
        metadata_json: { reprocess_id: reprocessId, source: 'reprocess' },
      });
    } catch (runErr) {
      console.error('connector_runs_record_failed:', (runErr as Error).message);
    }

    revalidatePath('/operacion/historial');
  }
}
