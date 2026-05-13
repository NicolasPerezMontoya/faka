/**
 * Idempotency helpers — CONSTR-idempotency-key per FND-08.
 *
 * The single composite is (canal, external_order_id) for sales (PATTERNS §5.9).
 * Every connector that writes facts goes through `idempotentUpsert` so
 * retries and DLQ replays do not duplicate rows.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Channel } from "@faka/schema";

/** Stable string composition for logs and tracing. */
export function idempotencyKey(
  canal: Channel,
  externalOrderId: string,
): string {
  return `${canal}:${externalOrderId}`;
}

export interface IdempotentUpsertOptions {
  /** Comma-separated unique constraint columns. e.g. 'canal,external_order_id'. */
  onConflict: string;
  /** Optional default to ignore-on-conflict instead of update. */
  ignoreDuplicates?: boolean;
}

/**
 * Wrapper over `supabase.from(table).upsert(row, { onConflict })` with a
 * clear error type and a stable signature for unit tests.
 *
 * Returns the upsert response from Supabase. Callers can inspect `.error`
 * for non-throw paths; we throw only on hard infrastructure failures (the
 * wrapper deliberately does not re-throw row-level constraint conflicts).
 */
export async function idempotentUpsert<T extends Record<string, unknown>>(
  supabase: SupabaseClient,
  table: string,
  row: T | T[],
  options: IdempotentUpsertOptions,
): Promise<{ rowsAffected: number; error: string | null }> {
  const payload = Array.isArray(row) ? row : [row];
  // Cast to Supabase's overload-unfriendly generic shape — payload is
  // structurally compatible but TS can't prove it against the inferred
  // RejectExcessProperties wrapper exposed by @supabase/supabase-js.
  const { error, count } = await supabase.from(table).upsert(payload as never, {
    onConflict: options.onConflict,
    ignoreDuplicates: options.ignoreDuplicates ?? false,
    count: "exact",
  });

  return {
    rowsAffected: count ?? payload.length,
    error: error?.message ?? null,
  };
}
