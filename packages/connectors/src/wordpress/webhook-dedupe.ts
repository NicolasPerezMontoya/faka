/**
 * WooCommerce webhook delivery-id dedupe (Plan 2.2.1).
 *
 * WC includes an `x-wc-webhook-delivery-id` header per delivery. We persist
 * each delivery into `raw_events` (canal='wordpress', tipo_evento='webhook')
 * with the delivery_id stored on the payload. The unique index on
 * `(canal, payload_json->>'_delivery_id')` (migration 20260601000003) lets
 * a duplicate INSERT no-op; we use INSERT ... ON CONFLICT DO NOTHING and
 * detect "newly inserted vs seen" by the inserted row count.
 *
 * Returns:
 *   true  → already seen, caller should ack-200 and skip processing
 *   false → newly inserted, caller should run the WC pull / enqueue work
 *
 * Pitfall 4 (RESEARCH): the dedupe row MUST be inserted in the same code
 * path that writes `raw_events`; never trust an in-memory map.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface DeliveryRecord {
  /** WC's `x-wc-webhook-delivery-id` header value. */
  delivery_id: string;
  /** WC's `x-wc-webhook-topic` (e.g. "order.updated"). Optional, stored for context. */
  topic?: string;
  /** Parsed JSON body — stored alongside the delivery marker. */
  body?: unknown;
}

export async function checkDeliverySeen(
  supabase: SupabaseClient,
  delivery: DeliveryRecord,
): Promise<boolean> {
  // Insert with ON CONFLICT DO NOTHING semantics on (canal, payload_json->>'_delivery_id').
  // Supabase JS does this via `.upsert(..., { onConflict, ignoreDuplicates: true })`.
  const row = {
    canal: "wordpress" as const,
    tipo_evento: "webhook",
    payload_json: {
      _delivery_id: delivery.delivery_id,
      topic: delivery.topic ?? null,
      body: delivery.body ?? null,
    },
    ocurrido_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("raw_events")
    .upsert(row, {
      onConflict: "canal,(payload_json->>'_delivery_id')",
      ignoreDuplicates: true,
    })
    .select("id");

  if (error) {
    // Re-throw — the caller (webhook handler) should ack non-200 so WC retries.
    throw new Error(`raw_events_dedupe_failed: ${error.message}`);
  }

  // `data` is the array of rows actually inserted. Length 0 → conflict → seen.
  if (!data || data.length === 0) return true;
  return false;
}
