import { z } from "zod";
import { ChannelSchema } from "./channel.js";

/**
 * NormalizedProduct — the result of applying a `MappingProfile.column_map`
 * to a raw CSV/API row, before persisting to `master_products`.
 *
 * Superset of fields across the 5 CSV templates (PATTERNS §5.8). Fields not
 * present in a specific channel's export stay undefined. The CSVConnector's
 * `applyColumnMap` + Zod parse is the ONLY place this conversion happens.
 */
export const NormalizedProductSchema = z.object({
  channel: ChannelSchema,
  external_id: z.string().min(1),
  sku: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  brand: z.string().optional(),
  price: z.number().nonnegative().optional(),
  cost: z.number().nonnegative().optional(),
  sale_price: z.number().nonnegative().optional(),
  barcode: z.string().optional(),
  supplier_code: z.string().optional(),
  image_url: z.string().url().optional(),
  stock: z.number().int().nonnegative().optional(),
  status: z.string().optional(),
  parent_sku: z.string().optional(),
  attributes_json: z.record(z.string(), z.unknown()).optional(),
});

export type NormalizedProduct = z.infer<typeof NormalizedProductSchema>;
