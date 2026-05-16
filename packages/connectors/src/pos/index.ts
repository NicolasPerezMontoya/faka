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

// -----------------------------------------------------------------------------
// Connection status — read by /configuracion/canales POS tile.
// -----------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPOSConfig } from "./config.js";

export interface POSConnectionStatus {
  configured: boolean;
  missing: string[];
  locations: Array<{
    location_id: string;
    canal: Channel;
    last_started_at: string | null;
    last_status: string | null;
    last_records_processed: number;
    last_records_failed: number;
  }>;
}

export async function getPOSConnectionStatus(
  supabase: SupabaseClient,
): Promise<POSConnectionStatus> {
  const cfg = loadPOSConfig();
  if (!cfg.ok) {
    return { configured: false, missing: cfg.missing, locations: [] };
  }

  const locs: POSConnectionStatus["locations"] = [];
  for (const [locationId, canal] of cfg.locations.entries()) {
    // Latest connector_runs row for this canal, tipo=orders.
    const { data } = await supabase
      .from("connector_runs")
      .select(
        "started_at, status, records_processed, records_failed, metadata_json",
      )
      .eq("kind", "channel")
      .eq("canal", canal)
      .order("started_at", { ascending: false })
      .limit(20);
    let last: {
      started_at: string;
      status: string;
      records_processed: number | null;
      records_failed: number | null;
    } | null = null;
    for (const r of (data ?? []) as Array<{
      started_at: string;
      status: string;
      records_processed: number | null;
      records_failed: number | null;
      metadata_json: { tipo?: string } | null;
    }>) {
      if (r.metadata_json?.tipo === "orders") {
        last = r;
        break;
      }
    }
    locs.push({
      location_id: locationId,
      canal,
      last_started_at: last?.started_at ?? null,
      last_status: last?.status ?? null,
      last_records_processed: Number(last?.records_processed ?? 0),
      last_records_failed: Number(last?.records_failed ?? 0),
    });
  }

  return {
    configured: true,
    missing: [],
    locations: locs,
  };
}
