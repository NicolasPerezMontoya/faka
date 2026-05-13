/**
 * Falabella connector skeleton.
 *
 * Deferred to Phase 6 (optional) per ROADMAP and FND-04. The skeleton
 * stays disabled-by-feature-flag — `healthCheck` reports the flag state
 * so the "Operación" view shows it as inactive.
 */

import type { Channel } from '@faka/schema';
import {
  type ChannelConnector,
  type ConnectorContext,
  type ConnectorFactory,
  type HealthStatus,
  type RawOrder,
  type RawProduct,
} from '../types.js';
import type { NormalizedOrder, NormalizedProduct } from '@faka/schema';

export interface FalabellaConnectorConfig {
  /** Falabella Sellercenter API key. Unused in F1; the connector is gated. */
  apiKey?: string;
  /** Feature flag — defaults to false. F6 flips this on after the cliente confirms. */
  enabled?: boolean;
}

export const createFalabellaConnector: ConnectorFactory<FalabellaConnectorConfig> = (config) => {
  const canal: Channel = 'falabella';
  const enabled = config.enabled ?? false;

  const connector: ChannelConnector = {
    name: 'falabella',
    canal,
    type: 'pull',
    capabilities: new Set(['orders', 'products']),

    async fetchOrders(_since: Date, _ctx: ConnectorContext): Promise<RawOrder[]> {
      throw new Error('NOT_IMPLEMENTED_F6: Falabella Sellercenter orders sync — Phase 6 (optional)');
    },

    async fetchProducts(_since: Date, _ctx: ConnectorContext): Promise<RawProduct[]> {
      throw new Error('NOT_IMPLEMENTED_F6: Falabella Sellercenter products sync — Phase 6 (optional)');
    },

    async normalizeOrder(_raw: RawOrder, _ctx: ConnectorContext): Promise<NormalizedOrder> {
      throw new Error('NOT_IMPLEMENTED_F6: Falabella order normalization — Phase 6');
    },

    async normalizeProduct(_raw: RawProduct, _ctx: ConnectorContext): Promise<NormalizedProduct> {
      throw new Error('NOT_IMPLEMENTED_F6: Falabella product normalization — Phase 6');
    },

    async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
      return {
        ok: false,
        last_error: enabled
          ? 'not configured (F1 skeleton; F6 enables real impl)'
          : 'disabled (feature flag off)',
      };
    },
  };

  return connector;
};
