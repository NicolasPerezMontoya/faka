/**
 * WordPress connector skeleton.
 * Real implementation lands in Phase 2 (Walking Skeleton) per ROADMAP.
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

export interface WordPressConnectorConfig {
  baseUrl: string;
  apiKey: string;
}

export const createWordPressConnector: ConnectorFactory<
  WordPressConnectorConfig
> = (_config) => {
  const canal: Channel = "wordpress";

  const connector: ChannelConnector = {
    name: "wordpress",
    canal,
    type: "pull",
    capabilities: new Set(["orders", "products", "inventory"]),

    async fetchOrders(
      _since: Date,
      _ctx: ConnectorContext,
    ): Promise<RawOrder[]> {
      throw new Error(
        "NOT_IMPLEMENTED_F2: WordPress orders sync — Phase 2 walking skeleton",
      );
    },

    async fetchProducts(
      _since: Date,
      _ctx: ConnectorContext,
    ): Promise<RawProduct[]> {
      throw new Error(
        "NOT_IMPLEMENTED_F2: WordPress products sync — Phase 2 walking skeleton",
      );
    },

    async normalizeOrder(
      _raw: RawOrder,
      _ctx: ConnectorContext,
    ): Promise<NormalizedOrder> {
      throw new Error(
        "NOT_IMPLEMENTED_F2: WordPress order normalization — Phase 2",
      );
    },

    async normalizeProduct(
      _raw: RawProduct,
      _ctx: ConnectorContext,
    ): Promise<NormalizedProduct> {
      throw new Error(
        "NOT_IMPLEMENTED_F2: WordPress product normalization — Phase 2",
      );
    },

    async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
      return { ok: false, last_error: "not configured (F1 skeleton)" };
    },
  };

  return connector;
};
