import { z } from 'zod';

/**
 * CustomerHint — emitted by `ChannelConnector.extractCustomerHint?` so the
 * F4 Mini-CRM cascade can resolve `customer_id` without each connector
 * having to know about the customers table.
 *
 * Per ADR-004 LOCKED — F1 declares this in the connector interface so F4
 * can populate Mini-CRM without modifying the interface.
 *
 * Sources:
 *   - 'order_payload' — extracted from the channel's order JSON (WP/ML/POS)
 *   - 'csv_row'       — extracted from a CSV row by CSVConnector
 *   - 'manual'        — typed in by a user through a UI (F3 form, F5.5 bot)
 */
export const CustomerHintSchema = z.object({
  phone: z.string().optional(),
  email: z.string().email().optional(),
  document_id: z.string().optional(),
  external_customer_id: z.string().optional(),
  external_identifier_type: z.enum(['phone', 'email', 'document', 'nickname']).optional(),
  displayed_name: z.string().optional(),
  source: z.enum(['order_payload', 'csv_row', 'manual']),
});

export type CustomerHint = z.infer<typeof CustomerHintSchema>;
