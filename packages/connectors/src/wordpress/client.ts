/**
 * WooCommerce REST client + Zod payload schemas (Plan 2.2.1).
 *
 * Thin wrapper around `@woocommerce/woocommerce-rest-api`. The SDK signs
 * requests for HTTPS endpoints using query-string auth (canonical signing
 * per RESEARCH §Pattern 2 — required when the WP host terminates TLS at a
 * proxy that strips the Authorization header).
 *
 * Zod schemas use `passthrough()` to keep unknown fields (WC v3 emits many
 * extras we don't map yet — currency_symbol, prices_include_tax, etc.) and
 * stay forward-compatible with WC plugin extensions.
 */

import { z } from "zod";
import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import type { WordPressConfig } from "./config.js";

export function createWooClient(cfg: WordPressConfig): WooCommerceRestApi {
  return new WooCommerceRestApi({
    url: cfg.apiUrl,
    consumerKey: cfg.apiKey,
    consumerSecret: cfg.apiSecret,
    version: "wc/v3",
    queryStringAuth: true,
  });
}

// -----------------------------------------------------------------------------
// WooCommerce v3 payload schemas (lean — only fields we map are required)
// -----------------------------------------------------------------------------

export const WCOrderLineItemSchema = z
  .object({
    id: z.number(),
    product_id: z.number(),
    variation_id: z.number().optional(),
    name: z.string(),
    quantity: z.number().int().positive(),
    subtotal: z.string(),
    total: z.string(),
    sku: z.string().optional().nullable(),
    price: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();
export type WCOrderLineItem = z.infer<typeof WCOrderLineItemSchema>;

export const WCBillingSchema = z
  .object({
    first_name: z.string().optional().nullable(),
    last_name: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    state: z.string().optional().nullable(),
  })
  .passthrough();
export type WCBilling = z.infer<typeof WCBillingSchema>;

export const WCShippingLineSchema = z
  .object({
    id: z.number().optional(),
    method_title: z.string().optional(),
    method_id: z.string().optional(),
    total: z.string().optional(),
  })
  .passthrough();
export type WCShippingLine = z.infer<typeof WCShippingLineSchema>;

export const WCOrderSchema = z
  .object({
    id: z.number(),
    status: z.string(),
    currency: z.string().default("COP"),
    date_created_gmt: z.string().optional(),
    date_modified_gmt: z.string(),
    discount_total: z.string().default("0"),
    shipping_total: z.string().default("0"),
    total: z.string(),
    payment_method: z.string().optional().nullable(),
    payment_method_title: z.string().optional().nullable(),
    customer_id: z.number().optional(),
    line_items: z.array(WCOrderLineItemSchema).default([]),
    shipping_lines: z.array(WCShippingLineSchema).default([]),
    billing: WCBillingSchema.optional(),
  })
  .passthrough();
export type WCOrder = z.infer<typeof WCOrderSchema>;

// -----------------------------------------------------------------------------
// WC product payload
// -----------------------------------------------------------------------------

export const WCProductMetaDataSchema = z
  .object({
    id: z.number().optional(),
    key: z.string(),
    value: z.unknown(),
  })
  .passthrough();

export const WCProductCategorySchema = z
  .object({
    id: z.number(),
    name: z.string(),
    slug: z.string().optional(),
  })
  .passthrough();

export const WCProductAttributeSchema = z
  .object({
    id: z.number().optional(),
    name: z.string(),
    options: z.array(z.string()).optional(),
  })
  .passthrough();

export const WCProductImageSchema = z
  .object({
    id: z.number().optional(),
    src: z.string().optional(),
  })
  .passthrough();

export const WCProductSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    sku: z.string().optional().nullable(),
    regular_price: z.string().optional().default(""),
    sale_price: z.string().optional().default(""),
    price: z.string().optional().default(""),
    status: z.string().optional(),
    stock_quantity: z.number().nullable().optional(),
    description: z.string().optional(),
    short_description: z.string().optional(),
    categories: z.array(WCProductCategorySchema).default([]),
    images: z.array(WCProductImageSchema).default([]),
    attributes: z.array(WCProductAttributeSchema).default([]),
    meta_data: z.array(WCProductMetaDataSchema).default([]),
    date_modified_gmt: z.string().optional(),
  })
  .passthrough();
export type WCProduct = z.infer<typeof WCProductSchema>;
