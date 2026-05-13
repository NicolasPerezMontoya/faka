/**
 * Cron entry — Railway invokes this on schedule (railway.toml).
 *
 * F1: only writes a heartbeat row to connector_runs so we can verify the
 * cron infrastructure is alive. Real channel-syncing crons land in F2+.
 *
 * RESEARCH §7 + Pitfall 7:
 *   - Process MUST `process.exit(0)` cleanly on success. Railway cron
 *     keeps the container alive until exit; hung processes get killed.
 *   - Minimum schedule granularity is 5 minutes (Railway constraint).
 *   - Schedule is UTC-only.
 *
 * W2 fix: writes with kind='cron-heartbeat' + canal=null. The DB CHECK
 * constraint on connector_runs + the recordConnectorRun helper both
 * enforce this; channel enum stays real-channels-only.
 */

import { recordConnectorRun } from '@faka/connectors';
import { log } from './lib/log.js';
import { getSupabase } from './lib/supabase.js';

async function main(): Promise<void> {
  const startedAt = new Date();
  const supabase = getSupabase();

  log.info({ ts: startedAt.toISOString() }, 'cron.heartbeat.start');

  try {
    await recordConnectorRun(supabase, {
      kind: 'cron-heartbeat',
      canal: null,
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      status: 'succeeded',
      records_processed: 0,
      records_failed: 0,
      retry_count: 0,
      errors_json: null,
      duration_ms: Date.now() - startedAt.getTime(),
      metadata_json: { source: 'railway-cron', node_version: process.version },
    });

    log.info('cron.heartbeat.done');
    process.exit(0);
  } catch (err) {
    log.error({ err: (err as Error).message }, 'cron.heartbeat.failed');
    process.exit(1);
  }
}

main().catch((err) => {
  log.fatal({ err: (err as Error).message }, 'cron.fatal');
  process.exit(1);
});
