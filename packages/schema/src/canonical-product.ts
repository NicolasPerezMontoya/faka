import { z } from 'zod';
import { ChannelSchema } from './channel.js';

/**
 * Canonical product — channel-agnostic shape that the matching cascade
 * (F2) consumes. Elevated from `scripts/discovery/types.ts:3-18` per
 * PATTERNS §5.2 (MOVE don't copy). `scripts/discovery/types.ts` re-exports
 * this so the discovery script keeps working.
 *
 * `master_sku` is set by the cascade once a match is resolved. NULL means
 * "pending validation". `raw_row` keeps the source CSV row for traceability.
 */
export const CanonicalProductSchema = z.object({
  channel: ChannelSchema,
  external_id: z.string(),
  sku: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  brand: z.string().optional(),
  price: z.number().optional(),
  cost: z.number().optional(),
  barcode: z.string().optional(),
  supplier_code: z.string().optional(),
  image_url: z.string().optional(),
  status: z.string().optional(),
  master_sku: z.string().uuid().optional(),
  raw_row: z.record(z.string(), z.string()).optional(),
});

export type CanonicalProduct = z.infer<typeof CanonicalProductSchema>;
