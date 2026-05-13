import { z } from 'zod';

/**
 * Connector-run categorization (W2 fix). Mirrors the `connector_run_kind`
 * Postgres enum from migration 0002. Kept SEPARATE from the `channel` enum
 * so the channel enum stays a clean real-channels-only contract.
 *
 * Consumed by `connector_runs.kind` writes. The DB CHECK constraint enforces:
 *   (kind = 'channel' AND canal IS NOT NULL) OR
 *   (kind = 'cron-heartbeat' AND canal IS NULL)
 */
export const ConnectorRunKindSchema = z.enum(['channel', 'cron-heartbeat']);

export type ConnectorRunKind = z.infer<typeof ConnectorRunKindSchema>;
