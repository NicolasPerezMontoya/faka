/**
 * Retry + dead-letter queue wrapper (RESEARCH §7 verbatim).
 *
 * - 3 retries, factor 2, minTimeout 1000ms (exponential backoff).
 * - On final failure inserts a row into `dead_letter_queue` and returns
 *   null instead of re-throwing so the caller can keep processing other
 *   work. The caller can then decide whether to alert or continue.
 *
 * RESEARCH §7: DO NOT introduce BullMQ or Redis. DLQ is a Postgres table.
 */

import pRetry, { AbortError } from "p-retry";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Channel } from "@faka/schema";

export interface WithRetryAndDLQOptions {
  canal: Channel;
  /** Logical sub-source within the canal, e.g. 'orders.fetch' or 'csv.row'. */
  source: string;
  /** Payload that will land in DLQ if all retries fail. Caller-defined shape. */
  payload: Record<string, unknown>;
  /** Default 3. Honored within p-retry's `retries` arg. */
  maxRetries?: number;
  /** Default 1000ms. */
  minTimeout?: number;
  /** Default 2. */
  factor?: number;
}

export async function withRetryAndDLQ<T>(
  fn: () => Promise<T>,
  options: WithRetryAndDLQOptions,
  supabase: SupabaseClient,
): Promise<T | null> {
  const maxRetries = options.maxRetries ?? 3;
  let attempts = 0;

  try {
    return await pRetry(
      async () => {
        attempts++;
        return fn();
      },
      {
        retries: maxRetries,
        minTimeout: options.minTimeout ?? 1000,
        factor: options.factor ?? 2,
      },
    );
  } catch (err) {
    // p-retry exhausted retries OR caller threw AbortError to skip retries.
    if (err instanceof AbortError) {
      // Aborted intentionally — don't write to DLQ.
      throw err;
    }
    const error = err as Error;
    await supabase.from("dead_letter_queue").insert({
      canal: options.canal,
      source: options.source,
      payload_json: options.payload,
      error: error.message ?? String(err),
      attempts,
      last_attempted_at: new Date().toISOString(),
    });
    return null;
  }
}
