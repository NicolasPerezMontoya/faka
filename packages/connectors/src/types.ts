/**
 * ChannelConnector interface — RESEARCH §5 verbatim, plus the ADR-004
 * `extractCustomerHint` hook that F4 wires without modifying the interface.
 *
 * Every channel implementation conforms to this contract:
 *   1. Skeleton in F1 that throws NOT_IMPLEMENTED_F<N> with the right tag.
 *   2. Real implementation lands in its named phase (F2 WP, F3 POS/WA form,
 *      F4 ML/Dropi/Mini-CRM, F5.5 WA Cloud API, F6 Falabella).
 *
 * The `CSVConnector` is the first concrete `ChannelConnector` (FND-05) and
 * the F1 acceptance gate.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Channel,
  CustomerHint,
  NormalizedOrder,
  NormalizedProduct,
} from "@faka/schema";

export type Capability = "orders" | "products" | "inventory" | "customers";
export type ConnectorType = "pull" | "push" | "manual";

export interface RawOrder {
  canal: Channel;
  payload_json: Record<string, unknown>;
  fetched_at?: string;
}

export interface RawProduct {
  canal: Channel;
  payload_json: Record<string, unknown>;
  fetched_at?: string;
}

export interface RawInventory {
  canal: Channel;
  payload_json: Record<string, unknown>;
  fetched_at?: string;
}

export interface HealthStatus {
  ok: boolean;
  last_success_at?: string;
  last_error?: string;
}

/**
 * Connector runtime context — what the orchestrator passes to every method.
 * Service-role Supabase client + structured logger + cancellation signal.
 */
export interface ConnectorContext {
  supabase: SupabaseClient;
  logger: {
    debug: (msg: string, meta?: Record<string, unknown>) => void;
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
  signal?: AbortSignal;
  /** Optional run id — when set, the connector should record progress on `connector_runs[run_id]`. */
  run_id?: string;
}

/**
 * The core contract — every channel (real + skeleton) implements this.
 *
 * Notes:
 *   - `fetchOrders/fetchProducts` are pull-only (WP/ML). Push connectors
 *     (POS webhook) return `[]` and rely on the orchestrator's webhook
 *     receiver writing directly to `raw_orders`.
 *   - `normalizeOrder/normalizeProduct` are pure functions — no side effects.
 *   - `extractCustomerHint` is optional. F4 enables Mini-CRM population
 *     without each connector having to know about customers.
 *   - `healthCheck` is called periodically by the orchestrator and surfaced
 *     in the "Operación" view per FND-08.
 */
export interface ChannelConnector {
  readonly name: string;
  readonly canal: Channel;
  readonly type: ConnectorType;
  readonly capabilities: Set<Capability>;

  fetchOrders(since: Date, ctx: ConnectorContext): Promise<RawOrder[]>;
  fetchProducts(since: Date, ctx: ConnectorContext): Promise<RawProduct[]>;
  fetchInventory?(ctx: ConnectorContext): Promise<RawInventory[]>;

  normalizeOrder(
    raw: RawOrder,
    ctx: ConnectorContext,
  ): Promise<NormalizedOrder>;
  normalizeProduct(
    raw: RawProduct,
    ctx: ConnectorContext,
  ): Promise<NormalizedProduct>;

  /**
   * ADR-004 LOCKED hook. Returning null is valid (e.g. ML/Dropi where
   * the buyer identity is anonymous to the seller). When non-null, F4's
   * Mini-CRM cascade resolves `customer_id` and the connector keeps
   * working unchanged.
   */
  extractCustomerHint?(raw: RawOrder): CustomerHint | null;

  healthCheck(ctx: ConnectorContext): Promise<HealthStatus>;
}

/**
 * Factory pattern — every connector exports `create<Channel>Connector(config)`
 * so the orchestrator can DI the runtime context separately from the
 * channel-specific config.
 */
export type ConnectorFactory<TConfig> = (config: TConfig) => ChannelConnector;

/**
 * Sentinel error thrown by skeleton connectors. Captures the target phase
 * so error messages stay informative when callers stumble onto a skeleton.
 */
export class NotImplementedError extends Error {
  constructor(
    public readonly phase: string,
    public readonly hint?: string,
  ) {
    super(`NOT_IMPLEMENTED_${phase}${hint ? `: ${hint}` : ""}`);
    this.name = "NotImplementedError";
  }
}
