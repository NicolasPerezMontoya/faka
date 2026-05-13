import { z } from "zod";

/**
 * NormalizedOrderItem — line-item shape used when an order export has
 * separate line files (WP/ML/Dropi/POS). When the source is free text
 * (WhatsApp `products_text`), the connector resolves to items via the
 * matching cascade (F2+) rather than emitting NormalizedOrderItem rows
 * directly.
 */
export const NormalizedOrderItemSchema = z.object({
  external_order_id: z.string().min(1),
  external_sku: z.string().optional(),
  external_product_id: z.string().optional(),
  product_name: z.string().min(1),
  quantity: z.number().int().positive(),
  unit_price: z.number().nonnegative(),
  unit_cost: z.number().nonnegative().optional(),
  line_discount: z.number().nonnegative().optional(),
  line_total: z.number().nonnegative(),
});

export type NormalizedOrderItem = z.infer<typeof NormalizedOrderItemSchema>;
