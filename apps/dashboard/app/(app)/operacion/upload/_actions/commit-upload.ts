"use server";

/**
 * commit-upload — the F1 acceptance gate Server Action.
 *
 * W1 BOUNDARY (PLAN.md 1.2.3 + 1.3.5):
 *   This action owns the WORKFLOW (file → Storage → raw_csv_rows → invoke
 *   CSVConnector.ingestUpload). It does NOT own normalization:
 *   - DOES NOT call applyColumnMap directly.
 *   - DOES NOT Zod-validate rows pre-write.
 *   - WRITES raw_csv_rows.payload_json AS-IS (raw Record<string,string>).
 *   - Calls csvConnector.ingestUpload which does the apply+validate+UPSERT.
 *
 * If you find yourself adding `applyColumnMap` here, STOP — the work
 * belongs in @faka/connectors/csv. The grep invariant in PLAN.md asserts
 * `applyColumnMap` count in this file is exactly 0.
 */

import { parse as parseCsvSync } from "csv-parse/sync";
import { redirect } from "next/navigation";
import { requireRole, ForbiddenError } from "@faka/auth";
import { createCSVConnector } from "@faka/connectors/csv";
import { recordConnectorRun } from "@faka/connectors";
import { auditLog } from "@faka/db";
import { createClient } from "@/lib/supabase/server";

const CHUNK_SIZE = 500;

export interface CommitUploadInput {
  uploadId: string;
  profileId: string;
}

export interface CommitUploadResult {
  ok: boolean;
  error?: string;
  rows_processed?: number;
  rows_skipped?: number;
}

export async function commitUploadAction(
  input: CommitUploadInput,
): Promise<CommitUploadResult> {
  const supabase = createClient();

  let ctx;
  try {
    ctx = await requireRole(supabase, ["super_admin", "admin", "manager"]);
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: "forbidden" };
    return { ok: false, error: "auth_failed" };
  }

  const startedAt = new Date();
  let runStatus: "succeeded" | "partial" | "failed" = "succeeded";
  let recordsProcessed = 0;
  let recordsFailed = 0;
  let errorsJson: Record<string, unknown> | null = null;

  try {
    // 1. Load upload metadata.
    const { data: upload, error: uploadErr } = await supabase
      .from("raw_csv_uploads")
      .select(
        "upload_id, canal_declarado, tipo, storage_path, mapping_profile_id, status",
      )
      .eq("upload_id", input.uploadId)
      .single();
    if (uploadErr || !upload) {
      return {
        ok: false,
        error: `upload_not_found: ${uploadErr?.message ?? input.uploadId}`,
      };
    }

    // 2. Ensure mapping_profile_id is set (caller passes the latest version).
    if (upload.mapping_profile_id !== input.profileId) {
      const { error: updateErr } = await supabase
        .from("raw_csv_uploads")
        .update({ mapping_profile_id: input.profileId })
        .eq("upload_id", input.uploadId);
      if (updateErr) {
        return {
          ok: false,
          error: `profile_link_failed: ${updateErr.message}`,
        };
      }
    }

    // 3. Download CSV bytes from Storage.
    const { data: bytes, error: downloadErr } = await supabase.storage
      .from("csv-uploads")
      .download(upload.storage_path);
    if (downloadErr || !bytes) {
      return {
        ok: false,
        error: `storage_download_failed: ${downloadErr?.message ?? "no data"}`,
      };
    }
    const text = await bytes.text();

    // 4. Parse CSV (csv-parse/sync). Verbatim per RESEARCH §6.
    let rows: Array<Record<string, string>>;
    try {
      rows = parseCsvSync(text, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_quotes: true,
      }) as Array<Record<string, string>>;
    } catch (parseErr) {
      return {
        ok: false,
        error: `csv_parse_failed: ${(parseErr as Error).message}`,
      };
    }

    // 5. Persist each parsed row AS-IS into raw_csv_rows (W1 — no applyColumnMap here).
    await supabase
      .from("raw_csv_uploads")
      .update({ status: "validating", row_count: rows.length })
      .eq("upload_id", input.uploadId);

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const batch = rows.slice(i, i + CHUNK_SIZE).map((row, idx) => ({
        upload_id: input.uploadId,
        row_number: i + idx,
        payload_json: row, // raw Record<string,string>
        processed: false,
      }));
      const { error: rowsErr } = await supabase
        .from("raw_csv_rows")
        .insert(batch);
      if (rowsErr) {
        runStatus = "failed";
        errorsJson = { phase: "raw_csv_rows_insert", message: rowsErr.message };
        return {
          ok: false,
          error: `raw_csv_rows_insert_failed: ${rowsErr.message}`,
        };
      }
    }

    // 6. Invoke CSVConnector.ingestUpload — W1: this is where applyColumnMap +
    //    Zod validate + UPSERT happen. We do NOT call applyColumnMap here.
    const connector = createCSVConnector({});
    type CSVConnectorWithIngest = typeof connector & {
      ingestUpload: (
        uploadId: string,
        ctx: {
          supabase: typeof supabase;
          logger: {
            debug: (msg: string, meta?: Record<string, unknown>) => void;
            info: (msg: string, meta?: Record<string, unknown>) => void;
            warn: (msg: string, meta?: Record<string, unknown>) => void;
            error: (msg: string, meta?: Record<string, unknown>) => void;
          };
        },
      ) => Promise<{
        upload_id: string;
        rows_processed: number;
        rows_skipped: number;
        errors: Array<{ row_number: number; field?: string; message: string }>;
      }>;
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
      errorsJson = { errors: ingestResult.errors.slice(0, 100) };
      runStatus = ingestResult.rows_processed === 0 ? "failed" : "partial";
    }

    // 7. Audit + result.
    await auditLog(supabase, {
      user_id: ctx.user.id,
      role_at_time: ctx.role,
      action: "csv_upload_processed",
      target_table: "raw_csv_uploads",
      target_id: input.uploadId,
      payload_json: {
        rows_processed: recordsProcessed,
        rows_skipped: recordsFailed,
        run_status: runStatus,
      },
    });

    return {
      ok: true,
      rows_processed: recordsProcessed,
      rows_skipped: recordsFailed,
    };
  } catch (err) {
    runStatus = "failed";
    errorsJson = { caught: (err as Error).message };
    return { ok: false, error: (err as Error).message };
  } finally {
    // RESEARCH §8: connector_runs written ONCE at the end, regardless of outcome.
    try {
      await recordConnectorRun(supabase, {
        kind: "channel",
        canal: "csv-upload",
        started_at: startedAt.toISOString(),
        completed_at: new Date().toISOString(),
        status: runStatus,
        records_processed: recordsProcessed,
        records_failed: recordsFailed,
        retry_count: 0,
        errors_json: errorsJson,
        duration_ms: Date.now() - startedAt.getTime(),
        upload_id: input.uploadId,
      });
    } catch (runErr) {
      // Don't mask the original error if the connector_run write fails.
      console.error("connector_runs_record_failed:", (runErr as Error).message);
    }
  }
}

export async function commitUploadAndRedirect(input: CommitUploadInput) {
  const result = await commitUploadAction(input);
  if (!result.ok) return result;
  redirect(`/operacion/historial?highlight=${input.uploadId}`);
}
