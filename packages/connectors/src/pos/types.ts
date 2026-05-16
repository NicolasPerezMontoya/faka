/**
 * POS API types — projection of phppointofsale.com OpenAPI v1.
 * Only the fields we consume; the full schema has dozens we don't need.
 */

export interface POSSaleItem {
  item_id?: number | null;
  name?: string;
  quantity?: number;
  unit_price?: number;
  /** Some verbosity levels include line discount / tax fields. */
  discount?: number;
  total?: number;
}

export interface POSSale {
  sale_id: number;
  /** ISO datetime. */
  sale_time: string;
  total: number;
  customer_id?: number | null;
  employee_id?: number | null;
  location_id: number;
  /** Verbosity full returns cart_items[]. Minimal/medium may not. */
  cart_items?: POSSaleItem[];
  /** Some installs expose a friendly customer name / phone at the top level. */
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  /** Cancellation / refund flag. */
  is_cancelled?: boolean;
}

export interface POSLocation {
  location_id: number;
  name: string;
}
