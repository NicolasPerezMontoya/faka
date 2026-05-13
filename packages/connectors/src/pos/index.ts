/**
 * POS connector skeleton.
 * Real implementation lands in Phase 3. Strategy: webhooks-first if the
 * POS programmer agrees (probable per discovery D.4), CSV/polling fallback
 * via CSVConnector. The webhook contract is designed jointly with the
 * client's POS programmer as the first task of F3.
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

export interface POSConnectorConfig {
  webhookSecret: string;
  /** When true, the connector also exposes a CSV reprocess path via CSVConnector. */
  csvFallback?: boolean;
}

export const createPOSConnector: ConnectorFactory<POSConnectorConfig> = (
  _config,
) => {
  const canal: Channel = "pos";

  const connector: ChannelConnector = {
    name: "pos",
    canal,
    type: "push",
    capabilities: new Set(["orders", "products", "inventory"]),

    async fetchOrders(
      _since: Date,
      _ctx: ConnectorContext,
    ): Promise<RawOrder[]> {
      // POS is push-style: webhook receiver in apps/orchestrator writes
      // raw_orders directly. Returning [] keeps the pull contract honest.
      return [];
    },

    async fetchProducts(
      _since: Date,
      _ctx: ConnectorContext,
    ): Promise<RawProduct[]> {
      throw new Error(
        "NOT_IMPLEMENTED_F3: POS products sync — Phase 3 via webhook+CSV",
      );
    },

    async normalizeOrder(
      _raw: RawOrder,
      _ctx: ConnectorContext,
    ): Promise<NormalizedOrder> {
      throw new Error("NOT_IMPLEMENTED_F3: POS order normalization — Phase 3");
    },

    async normalizeProduct(
      _raw: RawProduct,
      _ctx: ConnectorContext,
    ): Promise<NormalizedProduct> {
      throw new Error(
        "NOT_IMPLEMENTED_F3: POS product normalization — Phase 3",
      );
    },

    async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
      return { ok: false, last_error: "not configured (F1 skeleton)" };
    },
  };

  return connector;
};
