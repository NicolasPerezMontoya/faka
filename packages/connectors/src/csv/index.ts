/**
 * CSVConnector — the F1 acceptance gate connector.
 *
 * The FIRST concrete `ChannelConnector` (FND-05) and the only real impl
 * in F1. Other channel skeletons throw NOT_IMPLEMENTED.
 *
 * Boundary contract (W1 fix, PLAN 1.2.3 + 1.3.5):
 *   - `ingestUpload(uploadId)`: the NORMALIZATION engine. Reads
 *     pre-persisted `raw_csv_rows` for an upload, applies the linked
 *     `csv_mapping_profile.column_map_json`, Zod-validates, and UPSERTs
 *     normalized rows to `sales`/`sale_items` (orders) or
 *     `master_products`/`product_mappings` (products) using ON CONFLICT
 *     on the appropriate idempotency key. This is the ONLY place the
 *     applyColumnMap + Zod parse runs.
 *   - The Server Action that handles the wizard's file upload (1.3.5)
 *     owns the WORKFLOW: write file to Supabase Storage → parse CSV
 *     bytes → write rows AS-IS into `raw_csv_rows.payload_json` →
 *     call CSVConnector.ingestUpload. It does NOT invoke applyColumnMap.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  NormalizedOrderSchema,
  NormalizedProductSchema,
  type Channel,
  type CustomerHint,
  type NormalizedOrder,
  type NormalizedProduct,
} from '@faka/schema';
import type {
  ChannelConnector,
  ConnectorContext,
  ConnectorFactory,
  HealthStatus,
  RawOrder,
  RawProduct,
} from '../types.js';
import { applyColumnMap } from './column-map.js';

export interface CSVConnectorConfig {
  /** Defaults to Postgres-statement-friendly chunk size. */
  chunkSize?: number;
}

export interface IngestResult {
  upload_id: string;
  rows_processed: number;
  rows_skipped: number;
  errors: Array<{ row_number: number; field?: string; message: string }>;
}

const DEFAULT_CHUNK_SIZE = 500;

interface UploadRow {
  upload_id: string;
  canal_declarado: Channel;
  tipo: string;
  mapping_profile_id: string | null;
  status: string;
}

interface ProfileRow {
  id: string;
  canal: Channel;
  tipo: string;
  column_map_json: Record<string, string>;
}

interface RawCSVRow {
  row_number: number;
  payload_json: Record<string, string>;
}

export const createCSVConnector: ConnectorFactory<CSVConnectorConfig> = (config = {}) => {
  const chunkSize = config.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const canal: Channel = 'csv-upload';

  async function loadUpload(supabase: SupabaseClient, uploadId: string): Promise<UploadRow> {
    const { data, error } = await supabase
      .from('raw_csv_uploads')
      .select('upload_id, canal_declarado, tipo, mapping_profile_id, status')
      .eq('upload_id', uploadId)
      .single();
    if (error || !data) throw new Error(`upload_not_found: ${error?.message ?? uploadId}`);
    return data as UploadRow;
  }

  async function loadProfile(supabase: SupabaseClient, profileId: string): Promise<ProfileRow> {
    const { data, error } = await supabase
      .from('csv_mapping_profiles')
      .select('id, canal, tipo, column_map_json')
      .eq('id', profileId)
      .single();
    if (error || !data) throw new Error(`profile_not_found: ${error?.message ?? profileId}`);
    return data as ProfileRow;
  }

  async function setStatus(
    supabase: SupabaseClient,
    uploadId: string,
    status: 'uploaded' | 'validating' | 'processed' | 'failed',
    extras: Record<string, unknown> = {},
  ): Promise<void> {
    const { error } = await supabase
      .from('raw_csv_uploads')
      .update({ status, ...extras })
      .eq('upload_id', uploadId);
    if (error) throw new Error(`status_update_failed: ${error.message}`);
  }

  async function streamRows(
    supabase: SupabaseClient,
    uploadId: string,
    onBatch: (batch: RawCSVRow[]) => Promise<void>,
  ): Promise<number> {
    let processed = 0;
    let cursor = -1;
    for (;;) {
      const { data, error } = await supabase
        .from('raw_csv_rows')
        .select('row_number, payload_json')
        .eq('upload_id', uploadId)
        .is('superseded_at', null)
        .gt('row_number', cursor)
        .order('row_number', { ascending: true })
        .limit(chunkSize);
      if (error) throw new Error(`raw_csv_rows_read_failed: ${error.message}`);
      const batch = (data ?? []) as RawCSVRow[];
      if (batch.length === 0) break;
      await onBatch(batch);
      processed += batch.length;
      cursor = batch[batch.length - 1]!.row_number;
      if (batch.length < chunkSize) break;
    }
    return processed;
  }

  function safeNormalizeOrder(
    raw: Record<string, string>,
    column_map: Record<string, string>,
    channel: Channel,
  ): NormalizedOrder | { _error: { field?: string; message: string } } {
    const projected = applyColumnMap(raw, { column_map });
    (projected as Record<string, unknown>).channel = channel;
    const parsed = NormalizedOrderSchema.safeParse(projected);
    if (parsed.success) return parsed.data;
    const issue = parsed.error.issues[0];
    return { _error: { field: issue?.path.join('.'), message: issue?.message ?? 'invalid' } };
  }

  function safeNormalizeProduct(
    raw: Record<string, string>,
    column_map: Record<string, string>,
    channel: Channel,
  ): NormalizedProduct | { _error: { field?: string; message: string } } {
    const projected = applyColumnMap(raw, { column_map });
    (projected as Record<string, unknown>).channel = channel;
    const parsed = NormalizedProductSchema.safeParse(projected);
    if (parsed.success) return parsed.data;
    const issue = parsed.error.issues[0];
    return { _error: { field: issue?.path.join('.'), message: issue?.message ?? 'invalid' } };
  }

  async function upsertOrders(
    supabase: SupabaseClient,
    rows: NormalizedOrder[],
    uploadId: string,
  ): Promise<void> {
    if (rows.length === 0) return;
    const payload = rows.map((r) => ({
      canal: r.channel,
      external_order_id: r.external_order_id,
      fecha: r.order_date,
      hora: r.order_time ?? null,
      subtotal: r.subtotal ?? 0,
      descuento: r.discount ?? 0,
      total: r.total,
      costo_envio: r.shipping_cost ?? 0,
      moneda: r.currency,
      estado: r.status ?? 'pagado',
      punto_venta_id: r.pos_id ?? null,
      payment_method: r.payment_method ?? null,
      customer_external_id: r.customer_external_id ?? null,
      customer_phone: r.customer_phone ?? null,
      customer_email: r.customer_email ?? null,
      customer_name: r.customer_name ?? null,
      customer_city: r.customer_city ?? null,
      notes: r.notes ?? null,
      upload_id: uploadId,
    }));
    const { error } = await supabase
      .from('sales')
      .upsert(payload, { onConflict: 'canal,external_order_id' });
    if (error) throw new Error(`sales_upsert_failed: ${error.message}`);
  }

  async function upsertProducts(
    supabase: SupabaseClient,
    rows: NormalizedProduct[],
  ): Promise<void> {
    if (rows.length === 0) return;
    // F1 upserts to master_products by (barcode) when present, otherwise inserts new master_sku.
    // The full matching cascade is F2 work — F1's CSVConnector is "best-effort": it creates a
    // master_products row + product_mappings row per CSV product. The F2 cascade will dedupe.
    const masterPayload = rows.map((r) => ({
      nombre_canonico: r.name,
      brand: r.brand ?? null,
      category: r.category ?? null,
      barcode: r.barcode ?? null,
      supplier_code: r.supplier_code ?? null,
      precio_sugerido: r.price ?? null,
      costo_promedio: r.cost ?? null,
      imagen_principal: r.image_url ?? null,
      estado: r.status ?? 'activo',
      attributes_json: r.attributes_json ?? {},
    }));
    const { data: inserted, error: masterErr } = await supabase
      .from('master_products')
      .insert(masterPayload)
      .select('master_sku');
    if (masterErr) throw new Error(`master_products_insert_failed: ${masterErr.message}`);

    const mappingPayload = (inserted ?? []).map((m, i) => {
      const row = rows[i];
      if (!row) throw new Error('master_products_index_mismatch');
      return {
        master_sku: m.master_sku,
        canal: row.channel,
        external_id: row.external_id,
        external_sku: row.sku ?? null,
        external_name: row.name,
        match_method: row.barcode ? 'barcode_exact' : 'normalized_name_exact',
        score: row.barcode ? 1.0 : 0.9,
        validado_humano: false,
      };
    });

    const { error: mapErr } = await supabase
      .from('product_mappings')
      .upsert(mappingPayload, { onConflict: 'canal,external_id' });
    if (mapErr) throw new Error(`product_mappings_upsert_failed: ${mapErr.message}`);
  }

  async function markRowsProcessed(
    supabase: SupabaseClient,
    uploadId: string,
    rowNumbers: number[],
  ): Promise<void> {
    if (rowNumbers.length === 0) return;
    const { error } = await supabase
      .from('raw_csv_rows')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('upload_id', uploadId)
      .in('row_number', rowNumbers);
    if (error) throw new Error(`raw_csv_rows_processed_update_failed: ${error.message}`);
  }

  const connector: ChannelConnector & {
    ingestUpload: (uploadId: string, ctx: ConnectorContext) => Promise<IngestResult>;
  } = {
    name: 'csv-upload',
    canal,
    type: 'manual',
    capabilities: new Set(['orders', 'products', 'inventory']),

    async fetchOrders(_since: Date, _ctx: ConnectorContext): Promise<RawOrder[]> {
      return [];
    },

    async fetchProducts(_since: Date, _ctx: ConnectorContext): Promise<RawProduct[]> {
      return [];
    },

    async normalizeOrder(raw: RawOrder, _ctx: ConnectorContext): Promise<NormalizedOrder> {
      const profileColumnMap = (raw.payload_json._column_map ?? {}) as Record<string, string>;
      const channel = (raw.payload_json._channel as Channel) ?? raw.canal;
      const result = safeNormalizeOrder(
        raw.payload_json as Record<string, string>,
        profileColumnMap,
        channel,
      );
      if ('_error' in result) {
        throw new Error(`normalize_order_failed: ${result._error.message}`);
      }
      return result;
    },

    async normalizeProduct(raw: RawProduct, _ctx: ConnectorContext): Promise<NormalizedProduct> {
      const profileColumnMap = (raw.payload_json._column_map ?? {}) as Record<string, string>;
      const channel = (raw.payload_json._channel as Channel) ?? raw.canal;
      const result = safeNormalizeProduct(
        raw.payload_json as Record<string, string>,
        profileColumnMap,
        channel,
      );
      if ('_error' in result) {
        throw new Error(`normalize_product_failed: ${result._error.message}`);
      }
      return result;
    },

    extractCustomerHint(raw: RawOrder): CustomerHint | null {
      const payload = raw.payload_json as Record<string, unknown>;
      const phone = typeof payload.customer_phone === 'string' ? payload.customer_phone : undefined;
      const email = typeof payload.customer_email === 'string' ? payload.customer_email : undefined;
      const doc = typeof payload.customer_doc === 'string' ? payload.customer_doc : undefined;
      const name = typeof payload.customer_name === 'string' ? payload.customer_name : undefined;
      if (!phone && !email && !doc) return null;
      return {
        phone,
        email,
        document_id: doc,
        displayed_name: name,
        external_identifier_type: phone ? 'phone' : email ? 'email' : 'document',
        source: 'csv_row',
      };
    },

    async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
      return { ok: true };
    },

    async ingestUpload(uploadId: string, ctx: ConnectorContext): Promise<IngestResult> {
      const { supabase, logger } = ctx;

      logger.info('csv.ingestUpload.start', { uploadId });

      const upload = await loadUpload(supabase, uploadId);
      if (!upload.mapping_profile_id) {
        throw new Error('mapping_profile_missing: pick a profile before ingesting');
      }
      const profile = await loadProfile(supabase, upload.mapping_profile_id);

      await setStatus(supabase, uploadId, 'validating');

      const errors: IngestResult['errors'] = [];
      let validCount = 0;
      let skippedCount = 0;
      const targetTipo = upload.tipo;

      const processed = await streamRows(supabase, uploadId, async (batch) => {
        const validOrders: NormalizedOrder[] = [];
        const validProducts: NormalizedProduct[] = [];
        const rowsToMark: number[] = [];

        for (const row of batch) {
          if (targetTipo === 'orders' || targetTipo === 'order_items') {
            const r = safeNormalizeOrder(row.payload_json, profile.column_map_json, profile.canal);
            if ('_error' in r) {
              errors.push({ row_number: row.row_number, field: r._error.field, message: r._error.message });
              skippedCount++;
            } else {
              validOrders.push(r);
              rowsToMark.push(row.row_number);
              validCount++;
            }
          } else {
            const r = safeNormalizeProduct(row.payload_json, profile.column_map_json, profile.canal);
            if ('_error' in r) {
              errors.push({ row_number: row.row_number, field: r._error.field, message: r._error.message });
              skippedCount++;
            } else {
              validProducts.push(r);
              rowsToMark.push(row.row_number);
              validCount++;
            }
          }
        }

        try {
          if (validOrders.length > 0) await upsertOrders(supabase, validOrders, uploadId);
          if (validProducts.length > 0) await upsertProducts(supabase, validProducts);
          await markRowsProcessed(supabase, uploadId, rowsToMark);
        } catch (err) {
          logger.error('csv.ingestUpload.batch_failed', { err: (err as Error).message });
          throw err;
        }
      });

      const finalStatus = errors.length === 0 ? 'processed' : errors.length === processed ? 'failed' : 'processed';
      await setStatus(supabase, uploadId, finalStatus, {
        row_count: processed,
        error_log_json: errors.length > 0 ? { errors: errors.slice(0, 100) } : null,
      });

      logger.info('csv.ingestUpload.done', { uploadId, processed, validCount, skippedCount, errors: errors.length });

      return { upload_id: uploadId, rows_processed: validCount, rows_skipped: skippedCount, errors };
    },
  };

  return connector as ChannelConnector;
};

export { applyColumnMap } from './column-map.js';
export { dryRun } from './dry-run.js';
export { autoDetect, type AutoDetectSuggestion, type Confidence } from './auto-detect.js';
