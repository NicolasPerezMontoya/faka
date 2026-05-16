/**
 * POS API types — projection of the LIVE shape returned by fakastore.top's
 * PHP Point Of Sale install (more authoritative than the upstream OpenAPI
 * spec, which is outdated in several fields).
 *
 * Key deltas from the spec:
 *   - sale_time is `"MM/DD/YYYY hh:mm am/pm"` (Bogotá local), NOT ISO 8601.
 *   - sale_id / location_id / register_id / employee_id come as numeric strings.
 *   - cart_items rows: name + item_number (SKU) + item_id (product PK).
 *   - customer fields use first/last/_phone_number/_city instead of nested billing.
 *   - mode is the canonical status: "sale" | "return" | "estimate" | "work_order".
 */

export interface POSSaleItem {
  item_id?: string | number | null;
  variation_id?: string | number | null;
  product_id?: string | number | null;
  /** Seller-side SKU. */
  item_number?: string;
  name?: string;
  description?: string;
  size?: string;
  category_name?: string;
  /** Always a number. */
  quantity: number;
  /** Comes as a string with 2 decimals, e.g. "19000.00". */
  unit_price?: string | number;
  cost_price?: string | number;
  discount?: number;
  discount_percent?: number;
  discount_flat_discount?: number;
}

export interface POSSale {
  sale_id: string;
  /** "MM/DD/YYYY hh:mm am/pm" Bogotá local. */
  sale_time: string;
  location_id: string;
  location_name?: string;
  register_id?: string;
  employee_id?: string;
  /** "sale" | "return" | "estimate" | "work_order" | ... */
  mode?: string;
  /** Top-level total, already net of discounts/tax per the install's accounting. */
  total: number | string;
  sub_total?: number | string | null;
  discount?: number | string | null;
  tax?: number | string | null;
  payment_type?: string | null;
  comment?: string;
  /** Verbosity=full returns cart_items[]. */
  cart_items?: POSSaleItem[];

  // Customer block (flat, not nested).
  customer_id?: string | number | null;
  customer_first_name?: string;
  customer_last_name?: string;
  customer_company_name?: string;
  customer_email?: string;
  customer_phone_number?: string;
  customer_city?: string;
  customer_state?: string;
  customer_country?: string;
  customer_address_1?: string;
}

export interface POSLocation {
  location_id: number | string;
  name: string;
  address?: string;
  company?: string;
  timezone?: string;
}
