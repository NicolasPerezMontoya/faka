"use server";

import { createClient } from "@/lib/supabase/server";

export type QueueStatus = "queue" | "all" | "validated";

export interface MappingRow {
  mapping_id: string;
  canal: string;
  external_id: string;
  external_name: string | null;
  external_sku: string | null;
  match_method: string;
  score: number;
  validado_humano: boolean;
  created_at: string;
  validated_at: string | null;
  master_sku: string;
  nombre_canonico: string | null;
  brand: string | null;
}

const DEFAULT_QUEUE_CUTOFF = 0.78;

function queueCutoff(): number {
  const raw = process.env.MATCH_QUEUE_CUTOFF;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : DEFAULT_QUEUE_CUTOFF;
}

export async function listMappings({
  limit = 50,
  status = "queue",
}: {
  limit?: number;
  status?: QueueStatus;
} = {}): Promise<MappingRow[]> {
  const supabase = createClient();

  let query = supabase
    .from("product_mappings")
    .select(
      `
        id, canal, external_id, external_name, external_sku,
        match_method, score, validado_humano, created_at, validated_at,
        master_sku,
        master_products!product_mappings_master_sku_fkey ( nombre_canonico, brand )
      `,
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status === "queue") {
    query = query.eq("validado_humano", false).lt("score", queueCutoff());
  } else if (status === "validated") {
    query = query.eq("validado_humano", true);
  }

  const { data, error } = await query;

  if (error) {
    console.error("listMappings_failed:", error.message);
    return [];
  }

  return (data ?? []).map((row) => {
    const masterArr = row.master_products as
      | { nombre_canonico: string | null; brand: string | null }
      | { nombre_canonico: string | null; brand: string | null }[]
      | null;
    const master = Array.isArray(masterArr) ? masterArr[0] ?? null : masterArr;
    return {
      mapping_id: row.id as string,
      canal: row.canal as string,
      external_id: row.external_id as string,
      external_name: (row.external_name as string | null) ?? null,
      external_sku: (row.external_sku as string | null) ?? null,
      match_method: row.match_method as string,
      score: Number(row.score ?? 0),
      validado_humano: Boolean(row.validado_humano),
      created_at: row.created_at as string,
      validated_at: (row.validated_at as string | null) ?? null,
      master_sku: row.master_sku as string,
      nombre_canonico: master?.nombre_canonico ?? null,
      brand: master?.brand ?? null,
    };
  });
}
