/**
 * Mercado Libre connector skeleton.
 * Real implementation lands in Phase 4 (OAuth + official API).
 * Cliente debe crear developer app antes de empezar F4 (bloqueador documentado).
 */

import type { Channel } from "@faka/schema";
import {
  type ChannelConnector,
  type ConnectorContext,
  type ConnectorFactory,
  type HealthStatus,
  type RawOrder,
  type RawProduct,
} from "../types.js";
import type { NormalizedOrder, NormalizedProduct } from "@faka/schema";

export interface MercadoLibreConnectorConfig {
  clientId: string;
  clientSecret: string;
}

export const createMercadoLibreConnector: ConnectorFactory<
  MercadoLibreConnectorConfig
> = (_config) => {
  const canal: Channel = "mercadolibre";

  const connector: ChannelConnector = {
    name: "mercadolibre",
    canal,
    type: "pull",
    capabilities: new Set(["orders", "products", "inventory"]),

    async fetchOrders(
      _since: Date,
      _ctx: ConnectorContext,
    ): Promise<RawOrder[]> {
      throw new Error(
        "NOT_IMPLEMENTED_F4: Mercado Libre OAuth + orders sync — Phase 4",
      );
    },

    async fetchProducts(
      _since: Date,
      _ctx: ConnectorContext,
    ): Promise<RawProduct[]> {
      throw new Error(
        "NOT_IMPLEMENTED_F4: Mercado Libre publications sync — Phase 4",
      );
    },

    async normalizeOrder(
      _raw: RawOrder,
      _ctx: ConnectorContext,
    ): Promise<NormalizedOrder> {
      throw new Error(
        "NOT_IMPLEMENTED_F4: Mercado Libre order normalization — Phase 4",
      );
    },

    async normalizeProduct(
      _raw: RawProduct,
      _ctx: ConnectorContext,
    ): Promise<NormalizedProduct> {
      throw new Error(
        "NOT_IMPLEMENTED_F4: Mercado Libre product normalization — Phase 4",
      );
    },

    async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
      return { ok: false, last_error: "not configured (F1 skeleton)" };
    },
  };

  return connector;
};
