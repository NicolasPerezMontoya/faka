"use server";

import { createClient } from "@/lib/supabase/server";

export interface MappingDetail {
  mapping_id: string;
  canal: string;
  external_id: string;
  external_name: string | null;
  external_sku: string | null;
  match_method: string;
  score: number;
  validado_humano: boolean;
  validated_at: string | null;
  created_at: string;
  master_sku: string;
  master_nombre: string | null;
  master_brand: string | null;
  master_category: string | null;
  master_barcode: string | null;
  master_supplier_code: string | null;
}

export async function getMappingDetail(
  mappingId: string,
): Promise<MappingDetail | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("product_mappings")
    .select(
      `
        id, canal, external_id, external_name, external_sku,
        match_method, score, validado_humano, validated_at, created_at,
        master_sku,
        master_products!product_mappings_master_sku_fkey (
          nombre_canonico, brand, category, barcode, supplier_code
        )
      `,
    )
    .eq("id", mappingId)
    .maybeSingle();

  if (error) {
    console.error("getMappingDetail_failed:", error.message);
    return null;
  }
  if (!data) return null;

  type MasterShape = {
    nombre_canonico: string | null;
    brand: string | null;
    category: string | null;
    barcode: string | null;
    supplier_code: string | null;
  };
  const masterArr = data.master_products as MasterShape | MasterShape[] | null;
  const master = Array.isArray(masterArr) ? masterArr[0] ?? null : masterArr;

  return {
    mapping_id: data.id as string,
    canal: data.canal as string,
    external_id: data.external_id as string,
    external_name: (data.external_name as string | null) ?? null,
    external_sku: (data.external_sku as string | null) ?? null,
    match_method: data.match_method as string,
    score: Number(data.score ?? 0),
    validado_humano: Boolean(data.validado_humano),
    validated_at: (data.validated_at as string | null) ?? null,
    created_at: data.created_at as string,
    master_sku: data.master_sku as string,
    master_nombre: master?.nombre_canonico ?? null,
    master_brand: master?.brand ?? null,
    master_category: master?.category ?? null,
    master_barcode: master?.barcode ?? null,
    master_supplier_code: master?.supplier_code ?? null,
  };
}
