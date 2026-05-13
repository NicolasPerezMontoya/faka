/**
 * connector_runs writer (RESEARCH §8 — write ONCE at end of run).
 *
 * Enforces the W2 kind/canal coherence rule from migration 0008 at call-site:
 *   - kind='channel'        → canal MUST be a real channel value.
 *   - kind='cron-heartbeat' → canal MUST be null.
 *
 * Throws BEFORE writing if the rule is violated so the bad call is caught
 * loudly during dev / CI rather than silently writing a NULL-violating row
 * that fails on the DB CHECK constraint.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Channel, ConnectorRunKind } from '@faka/schema';

export interface RecordConnectorRunInput {
  kind: ConnectorRunKind;
  canal: Channel | null;
  started_at: string;
  completed_at?: string | null;
  status: 'succeeded' | 'partial' | 'failed' | 'running';
  records_processed?: number;
  records_failed?: number;
  retry_count?: number;
  errors_json?: Record<string, unknown> | null;
  duration_ms?: number | null;
  upload_id?: string | null;
  metadata_json?: Record<string, unknown> | null;
}

export async function recordConnectorRun(
  supabase: SupabaseClient,
  input: RecordConnectorRunInput,
): Promise<{ id: string }> {
  // W2 fix — coherence rule mirrors the CHECK constraint in migration 0008.
  if (input.kind === 'channel' && input.canal === null) {
    throw new Error(
      "kind_canal_violation: kind='channel' requires canal to be a real channel value, got null",
    );
  }
  if (input.kind === 'cron-heartbeat' && input.canal !== null) {
    throw new Error(
      `kind_canal_violation: kind='cron-heartbeat' requires canal=null, got '${input.canal}'`,
    );
  }

  const row = {
    kind: input.kind,
    canal: input.canal,
    started_at: input.started_at,
    completed_at: input.completed_at ?? null,
    status: input.status,
    records_processed: input.records_processed ?? 0,
    records_failed: input.records_failed ?? 0,
    retry_count: input.retry_count ?? 0,
    errors_json: input.errors_json ?? null,
    duration_ms: input.duration_ms ?? null,
    upload_id: input.upload_id ?? null,
    metadata_json: input.metadata_json ?? null,
  };

  const { data, error } = await supabase
    .from('connector_runs')
    .insert(row)
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`connector_runs_insert_failed: ${error?.message ?? 'no data'}`);
  }

  return { id: data.id as string };
}
