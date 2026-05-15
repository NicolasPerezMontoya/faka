/**
 * Mercado Libre narrow TypeScript types (PATTERNS §6).
 *
 * Lifted-verbatim structure from `packages/connectors/src/types.ts:1-12`:
 * thin, narrow shape definitions — the connector touches a small subset of
 * the ML response surface; `raw_orders.payload_json` (and the equivalent
 * append-only ledgers) preserve the full payload so we can re-derive any
 * unmapped field later without re-fetching.
 *
 * The Zod schemas + the runtime API client (`api-client.ts`, Plan 2.1.2.1)
 * are intentionally NOT in this file — keep `types.ts` framework-free so it
 * can be imported from both `oauth.ts` and the eventual `index.ts` rewrite
 * without pulling in undici or Zod at every consumer site.
 *
 * Single-site invariant (PATTERNS §"F2.1-NEW — Single ML site hardcoded"):
 *   The cliente operates on Mercado Libre Colombia ONLY in v1.
 *   `ML_SITE_ID = "MCO"` and `ML_CURRENCY = "COP"` are constants here, NOT
 *   env vars — multi-site support is a future migration, NOT a config flip.
 *
 * ML-specific oddities documented inline (per PATTERNS §6):
 *   - `order.total_amount` is a `number` (not a stringified decimal as in
 *     WooCommerce).
 *   - `order.date_created` and friends are ISO 8601 with the literal `-05:00`
 *     suffix for MCO (Colombia does not observe DST — RESEARCH §Pitfall 11).
 *   - `item.id` is the literal ML item id starting with `MCO`
 *     (e.g. `"MCO123456789"`). Treat it as opaque text, never parse.
 *   - `buyer.email` is frequently a masked alias like `nickname@example.com`
 *     — the receipt PII contract still treats it as the customer email but
 *     do NOT rely on it for direct reach (RESEARCH §Privacy V8).
 *   - `cancel_detail` (top-level on `MLOrder`) carries the buyer/seller
 *     cancellation reason; preserve it verbatim into `sales.notes` (don't
 *     collapse into `cancelado` alone — RESEARCH §Pitfall 6, finance reports
 *     lose buyer-vs-seller signal).
 */

// -----------------------------------------------------------------------------
// Single-site invariants — PATTERNS §"F2.1-NEW — Single ML site hardcoded".
// -----------------------------------------------------------------------------

export const ML_SITE_ID = "MCO" as const;
export const ML_CURRENCY = "COP" as const;

export type MLSiteId = typeof ML_SITE_ID;
export type MLCurrency = typeof ML_CURRENCY;

// -----------------------------------------------------------------------------
// OAuth — config + responses.
// -----------------------------------------------------------------------------

/**
 * Loaded ML environment contract.
 *
 * `redirectUri` is required to be HTTPS per RESEARCH §Security V9; the
 * actual gate lives in `config.ts` (Plan 2.1.2.3). This type only carries
 * the four post-validation strings.
 */
export interface MLConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  webhookSecret: string;
}

/**
 * Raw OAuth token response from `POST https://api.mercadolibre.com/oauth/token`.
 *
 * `expires_in` is seconds (typically 21600 = 6 hours per PATTERNS §2).
 * `refresh_token` is single-use — every successful refresh rotates BOTH
 * tokens server-side (RESEARCH §Pattern 1). Losing the rotated refresh
 * bricks the integration until the cliente re-authorizes.
 *
 * `user_id` is a number in the wire format; we keep that number on the
 * envelope and the `oauth_tokens` table column is `text` (so all callers
 * String-coerce on UPSERT).
 */
export interface MLTokenResponse {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  scope?: string;
  user_id: number;
  refresh_token: string;
}

/**
 * Discriminated-union envelope (PATTERNS §6).
 *
 * `ok:true` → caller gets the rotated tokens.
 * `ok:false` → caller gets a structured error + optional HTTP status; never
 * throws so partial-batch resilience holds at the cron layer.
 */
export type MLTokenResult =
  | { ok: true; response: MLTokenResponse }
  | { ok: false; error: string; status?: number };

/**
 * Mirror of `public.oauth_tokens` Row, narrowed to the fields `oauth.ts`
 * actually reads/writes. The full Row type lives in
 * `packages/db/types/database.ts`; this alias keeps the connector layer
 * isolated from the codegen surface.
 */
export interface OAuthTokenRow {
  id: string;
  canal: "mercadolibre";
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scope: string | null;
  created_at: string;
  updated_at: string;
}

// -----------------------------------------------------------------------------
// Order surface — narrow subset (see RESEARCH §Code Examples).
// -----------------------------------------------------------------------------

/**
 * Buyer envelope.
 *
 * `email` is frequently masked (`nickname@example.com`); preserve it as-is
 * for the CRM hint pipeline (ADR-004 LOCKED) and let downstream consumers
 * decide whether the alias is reachable.
 */
export interface MLBuyer {
  id: number;
  nickname?: string | null;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: {
    area_code?: string | null;
    number?: string | null;
    extension?: string | null;
  } | null;
  billing_info?: {
    doc_type?: string | null;
    doc_number?: string | null;
  } | null;
}

/**
 * A single line on an ML order. Note `quantity` is integer and `unit_price`
 * is a number (the wire format — NOT a string as WooCommerce uses).
 */
export interface MLOrderItem {
  item: {
    id: string;
    title: string;
    category_id?: string | null;
    variation_id?: number | null;
    seller_custom_field?: string | null;
    variation_attributes?: Array<{ name: string; value_name: string | null }>;
    warranty?: string | null;
    condition?: string | null;
    seller_sku?: string | null;
  };
  quantity: number;
  unit_price: number;
  full_unit_price?: number;
  currency_id: MLCurrency | string;
  sale_fee?: number;
  listing_type_id?: string;
}

/**
 * Shipment envelope. `shipping_cost` lives at the order level on ML
 * (not on the shipment) so callers should pull it from `MLOrder.shipping_cost`
 * — RESEARCH §Pitfall 10: do NOT back-derive shipping from
 * `total - sum(items)`.
 */
export interface MLShipment {
  id: number | null;
  shipment_type?: string | null;
  status?: string | null;
  substatus?: string | null;
  receiver_address?: {
    id?: number | null;
    address_line?: string | null;
    street_name?: string | null;
    street_number?: string | null;
    comment?: string | null;
    zip_code?: string | null;
    city?: { id?: string; name?: string } | null;
    state?: { id?: string; name?: string } | null;
    country?: { id?: string; name?: string } | null;
    receiver_phone?: string | null;
    receiver_name?: string | null;
  } | null;
}

/**
 * Order envelope. `cancel_detail` is the buyer/seller cancellation reason
 * — preserve it on `sales.notes` (RESEARCH §Pitfall 6, never collapse).
 */
export interface MLOrder {
  id: number;
  status: string;
  status_detail?: string | null;
  date_created: string;
  date_closed?: string | null;
  last_updated?: string | null;
  expiration_date?: string | null;
  site_id: MLSiteId | string;
  currency_id: MLCurrency | string;
  total_amount: number;
  paid_amount?: number;
  shipping_cost?: number;
  coupon?: unknown;
  buyer: MLBuyer;
  seller?: { id: number; nickname?: string };
  order_items: MLOrderItem[];
  payments?: Array<{
    id: number;
    status: string;
    status_detail?: string | null;
    transaction_amount: number;
    payment_method_id?: string;
    payment_type?: string;
    installments?: number;
    date_approved?: string | null;
  }>;
  shipping?: MLShipment;
  feedback?: unknown;
  tags?: string[];
  cancel_detail?: string | null;
  context?: {
    channel?: string;
    site?: string;
    flows?: string[];
  };
}

// -----------------------------------------------------------------------------
// Item / Variation surface.
// -----------------------------------------------------------------------------

/**
 * Variation envelope. `seller_custom_field` is the seller-defined SKU
 * we use as `master_sku_hint` in the variant mapper (Plan 2.1.2.2).
 *
 * Per-variation pricing is stored under `atributos_json.__pricing` on the
 * `product_variants` row (FLAGGED in PATTERNS §5 as deferrable — no
 * column-level pricing in v1).
 */
export interface MLVariation {
  id: number;
  price: number;
  attribute_combinations: Array<{
    id: string;
    name: string;
    value_name: string | null;
  }>;
  available_quantity: number;
  sold_quantity?: number;
  seller_custom_field?: string | null;
  picture_ids?: string[];
}

/**
 * Listing (item) envelope. `catalog_product_id != null` means the listing
 * is using ML's catalog-products mode — out of scope for v1 (RESEARCH
 * §Pitfall 9 + Assumption A2). The api-client + variant-mapper both DLQ +
 * skip such items.
 */
export interface MLItem {
  id: string;
  site_id: MLSiteId | string;
  title: string;
  subtitle?: string | null;
  seller_id: number;
  category_id?: string | null;
  official_store_id?: number | null;
  price: number;
  base_price?: number;
  original_price?: number | null;
  currency_id: MLCurrency | string;
  initial_quantity?: number;
  available_quantity?: number;
  sold_quantity?: number;
  buying_mode?: string;
  listing_type_id?: string;
  condition?: string;
  permalink?: string;
  thumbnail?: string;
  secure_thumbnail?: string;
  status?: string;
  domain_id?: string;
  seller_custom_field?: string | null;
  catalog_product_id?: string | null;
  attributes?: Array<{
    id?: string;
    name: string;
    value_name?: string | null;
  }>;
  pictures?: Array<{
    id?: string;
    url?: string;
    secure_url?: string;
  }>;
  variations?: MLVariation[];
  date_created?: string;
  last_updated?: string;
}

// -----------------------------------------------------------------------------
// Webhook envelope — RESEARCH §Pattern 2 + Code Examples.
// -----------------------------------------------------------------------------

/**
 * ML webhook body. Per RESEARCH §Anti-Patterns: DO NOT trust the body for
 * state. The handler INSERTs the pointer into `raw_events` and the next
 * `sync-ml-orders` tick re-fetches the resource fresh.
 */
export interface MLWebhookNotification {
  _id?: string;
  resource: string;
  user_id: number;
  topic: string;
  application_id?: number;
  attempts?: number;
  sent?: string;
  received?: string;
  actions?: string[];
}
