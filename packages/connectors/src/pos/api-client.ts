/**
 * PHP Point Of Sale REST client — thin wrapper around `undici.request`.
 *
 * Auth: `x-api-key` header (apiKey scheme per the OpenAPI spec).
 * Pagination: offset/limit (default limit 500, max 1000). The total count is
 * returned in the `x-total-records` response header, so we drain via offset
 * walking instead of cursors.
 *
 * Errors: non-2xx surfaces as `POSApiError`; the cron driver catches and
 * records as `connector_runs.errors_json` plus increments `records_failed`.
 *
 * NEVER logs the API key.
 */

import { request } from "undici";
import type { POSSale, POSLocation } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const PAGE_LIMIT = 500;

export class POSApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "POSApiError";
  }
}

export interface POSApiClient {
  searchSales(opts: {
    startDate: string; // ISO 8601 in seconds
    endDate: string;
    locationId: number;
    verbosity?: "minimal" | "medium" | "full";
  }): Promise<POSSale[]>;
  listLocations(): Promise<POSLocation[]>;
}

export interface POSApiClientCtx {
  apiUrl: string;
  apiKey: string;
  /** Optional logger; defaults to console-noop. */
  logger?: {
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    info?: (msg: string, meta?: Record<string, unknown>) => void;
    debug?: (msg: string, meta?: Record<string, unknown>) => void;
    error?: (msg: string, meta?: Record<string, unknown>) => void;
  };
  /** Override fetcher for tests. */
  fetcher?: typeof request;
}

export function createPOSApiClient(ctx: POSApiClientCtx): POSApiClient {
  const fetcher = ctx.fetcher ?? request;
  const baseHeaders = {
    accept: "application/json",
    "x-api-key": ctx.apiKey,
  };

  async function getJson(path: string): Promise<{
    body: unknown;
    totalRecords: number | null;
  }> {
    const url = `${ctx.apiUrl}${path}`;
    const { statusCode, headers, body } = await fetcher(url, {
      method: "GET",
      headers: baseHeaders,
      headersTimeout: DEFAULT_TIMEOUT_MS,
      bodyTimeout: DEFAULT_TIMEOUT_MS,
    });
    const text = await body.text();
    if (statusCode < 200 || statusCode >= 300) {
      throw new POSApiError(
        statusCode,
        `pos_api_${statusCode}: ${text.slice(0, 240)}`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new POSApiError(statusCode, "pos_api_response_not_json");
    }
    const totalHeader = headers["x-total-records"];
    const total = Array.isArray(totalHeader)
      ? Number(totalHeader[0])
      : totalHeader
        ? Number(totalHeader)
        : null;
    return { body: parsed, totalRecords: Number.isFinite(total) ? (total as number) : null };
  }

  return {
    async searchSales({ startDate, endDate, locationId, verbosity = "full" }) {
      const out: POSSale[] = [];
      let offset = 0;
      while (true) {
        const params = new URLSearchParams({
          start_date: startDate,
          end_date: endDate,
          location_id: String(locationId),
          verbosity,
          offset: String(offset),
          limit: String(PAGE_LIMIT),
        });
        const { body, totalRecords } = await getJson(`/sales?${params.toString()}`);
        const page = (Array.isArray(body) ? body : []) as POSSale[];
        out.push(...page);
        ctx.logger?.debug?.("pos.api.sales.page", {
          location_id: locationId,
          offset,
          got: page.length,
          total: totalRecords,
        });
        if (page.length < PAGE_LIMIT) break;
        offset += page.length;
        // Safety bound: never loop past 10k.
        if (offset > 10_000) {
          ctx.logger?.warn("pos.api.sales.page_cap", { offset });
          break;
        }
      }
      return out;
    },

    async listLocations() {
      const { body } = await getJson(`/locations?limit=1000`);
      return (Array.isArray(body) ? body : []) as POSLocation[];
    },
  };
}
