"use server";

import { createClient } from "@/lib/supabase/server";

export interface UploadHistoryRow {
  upload_id: string;
  canal_declarado: string;
  tipo: string;
  filename: string;
  bytes: number;
  row_count: number;
  status: string;
  uploaded_at: string;
  uploaded_by: string | null;
  mapping_profile_id: string | null;
  error_log_json: Record<string, unknown> | null;
  mapping_profile_nombre: string | null;
  mapping_profile_version: number | null;
}

export async function listUploads(limit = 50): Promise<UploadHistoryRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("raw_csv_uploads")
    .select(
      `
        upload_id, canal_declarado, tipo, filename, bytes, row_count,
        status, uploaded_at, uploaded_by, mapping_profile_id, error_log_json,
        csv_mapping_profiles!raw_csv_uploads_mapping_profile_id_fkey ( nombre, version )
      `,
    )
    .order("uploaded_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("listUploads_failed:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    upload_id: row.upload_id as string,
    canal_declarado: row.canal_declarado as string,
    tipo: row.tipo as string,
    filename: row.filename as string,
    bytes: row.bytes as number,
    row_count: row.row_count as number,
    status: row.status as string,
    uploaded_at: row.uploaded_at as string,
    uploaded_by: (row.uploaded_by as string | null) ?? null,
    mapping_profile_id: (row.mapping_profile_id as string | null) ?? null,
    error_log_json:
      (row.error_log_json as Record<string, unknown> | null) ?? null,
    mapping_profile_nombre:
      (row as unknown as { csv_mapping_profiles?: { nombre?: string } })
        .csv_mapping_profiles?.nombre ?? null,
    mapping_profile_version:
      (row as unknown as { csv_mapping_profiles?: { version?: number } })
        .csv_mapping_profiles?.version ?? null,
  }));
}
