/**
 * WhatsApp connector skeleton.
 *
 * Per ADR-003 LOCKED — strategy split:
 *   - F3 ships an INTERNAL FORM in the dashboard (manual entry; ≤4 clicks).
 *     The form Server Action calls Supabase directly; this connector stays
 *     a skeleton because the form doesn't need the ChannelConnector contract.
 *   - F5.5 ships the WhatsApp Business Cloud API integration: webhook
 *     receiver + parser + outbound sender. THAT is where this connector
 *     becomes a real impl.
 *
 * Until F5.5, the form is the entry point and `messaging_log` stays empty
 * (CC-14 in PLAN.md asserts count() = 0 throughout F1).
 */

import type { Channel } from '@faka/schema';
import {
  type ChannelConnector,
  type ConnectorContext,
  type ConnectorFactory,
  type HealthStatus,
  NotImplementedError,
  type RawOrder,
  type RawProduct,
} from '../types.js';
import type { NormalizedOrder, NormalizedProduct } from '@faka/schema';

export interface WhatsAppConnectorConfig {
  /** Meta Business phone number id (F5.5 only). */
  phoneNumberId?: string;
  /** Meta Cloud API access token (F5.5 only). */
  accessToken?: string;
  /** Webhook signature verify token (F5.5 only). */
  webhookVerifyToken?: string;
}

export const createWhatsAppConnector: ConnectorFactory<WhatsAppConnectorConfig> = (_config) => {
  const canal: Channel = 'whatsapp';

  const connector: ChannelConnector = {
    name: 'whatsapp',
    canal,
    type: 'manual',
    capabilities: new Set(['orders']),

    async fetchOrders(_since: Date, _ctx: ConnectorContext): Promise<RawOrder[]> {
      throw new NotImplementedError(
        'F5.5',
        'WhatsApp Business Cloud API inbound — Phase 5.5 (the F3 form does not use this connector)',
      );
    },

    async fetchProducts(_since: Date, _ctx: ConnectorContext): Promise<RawProduct[]> {
      return [];
    },

    async normalizeOrder(_raw: RawOrder, _ctx: ConnectorContext): Promise<NormalizedOrder> {
      throw new Error('NOT_IMPLEMENTED_F5.5: WhatsApp order normalization — Phase 5.5');
    },

    async normalizeProduct(_raw: RawProduct, _ctx: ConnectorContext): Promise<NormalizedProduct> {
      throw new Error('NOT_IMPLEMENTED_F3: WhatsApp products not a meaningful entity');
    },

    async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
      return {
        ok: false,
        last_error: 'not configured (F1 skeleton — F3 form is the active path; F5.5 integration deferred)',
      };
    },
  };

  return connector;
};
