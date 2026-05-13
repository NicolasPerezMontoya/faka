/**
 * Dropi connector skeleton.
 * Real implementation lands in Phase 4. Strategy per discovery findings
 * (docs/discovery-findings.md): CSV manual export is PRIMARY route; the
 * Playwright scraper is optional/deferred. When ingestion is needed,
 * delegate to CSVConnector (ADR-001) — no Dropi-specific CSV code.
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

export interface DropiConnectorConfig {
  username: string;
  password: string;
}

export const createDropiConnector: ConnectorFactory<DropiConnectorConfig> = (
  _config,
) => {
  const canal: Channel = "dropi";

  const connector: ChannelConnector = {
    name: "dropi",
    canal,
    type: "pull",
    capabilities: new Set(["orders", "products"]),

    async fetchOrders(
      _since: Date,
      _ctx: ConnectorContext,
    ): Promise<RawOrder[]> {
      throw new Error(
        "NOT_IMPLEMENTED_F4: Dropi — CSV via CSVConnector is primary; scraper deferred",
      );
    },

    async fetchProducts(
      _since: Date,
      _ctx: ConnectorContext,
    ): Promise<RawProduct[]> {
      throw new Error(
        "NOT_IMPLEMENTED_F4: Dropi products sync via CSVConnector — Phase 4",
      );
    },

    async normalizeOrder(
      _raw: RawOrder,
      _ctx: ConnectorContext,
    ): Promise<NormalizedOrder> {
      throw new Error(
        "NOT_IMPLEMENTED_F4: Dropi order normalization — Phase 4 via CSVConnector",
      );
    },

    async normalizeProduct(
      _raw: RawProduct,
      _ctx: ConnectorContext,
    ): Promise<NormalizedProduct> {
      throw new Error(
        "NOT_IMPLEMENTED_F4: Dropi product normalization — Phase 4 via CSVConnector",
      );
    },

    async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
      return { ok: false, last_error: "not configured (F1 skeleton)" };
    },
  };

  return connector;
};
