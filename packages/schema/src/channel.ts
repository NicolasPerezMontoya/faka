import { z } from "zod";

/**
 * Real channels only — mirrors the `channel` Postgres enum from migration 0002.
 *
 * Note (W2 fix / PATTERNS §5.4): non-channel run categories (e.g. 'cron-heartbeat')
 * live in the separate `ConnectorRunKindSchema` in `./connector-run-kind.ts`.
 * DO NOT add 'cron-heartbeat' to this enum.
 */
export const ChannelSchema = z.enum([
  "wordpress",
  "mercadolibre",
  "dropi",
  "pos",
  "pos1",
  "pos2",
  "whatsapp",
  "csv-upload",
  "falabella",
]);

export type Channel = z.infer<typeof ChannelSchema>;
