import { z } from "zod";
import { ChannelSchema } from "./channel.js";

/**
 * NormalizedOrder — the result of applying a `MappingProfile.column_map`
 * to a raw order CSV/API row, before persisting to `sales`.
 *
 * Composite key (channel + external_order_id) is the idempotency key
 * (CONSTR-idempotency-key / PATTERNS §5.9). Customer fields are kept
 * separate from `customer_id` (which is filled by F4 Mini-CRM matching).
 */
export const NormalizedOrderSchema = z.object({
  channel: ChannelSchema,
  external_order_id: z.string().min(1),
  order_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "order_date must be ISO YYYY-MM-DD"),
  order_time: z.string().optional(),
  customer_external_id: z.string().optional(),
  customer_name: z.string().optional(),
  customer_phone: z.string().optional(),
  customer_email: z.string().email().optional(),
  customer_doc: z.string().optional(),
  customer_city: z.string().optional(),
  customer_dept: z.string().optional(),
  status: z.string().optional(),
  payment_method: z.string().optional(),
  shipping_method: z.string().optional(),
  delivery_method: z.string().optional(),
  cashier_id: z.string().optional(),
  pos_id: z.string().optional(),
  subtotal: z.number().nonnegative().optional(),
  discount: z.number().nonnegative().optional(),
  shipping_cost: z.number().nonnegative().optional(),
  commission: z.number().nonnegative().optional(),
  tax: z.number().nonnegative().optional(),
  total: z.number().nonnegative(),
  currency: z.string().default("COP"),
  notes: z.string().optional(),
  products_text: z.string().optional(),
});

export type NormalizedOrder = z.infer<typeof NormalizedOrderSchema>;
