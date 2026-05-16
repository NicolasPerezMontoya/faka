/**
 * POS env loader — Phase 3 (PHP Point Of Sale REST v1).
 *
 * Three envs:
 *   POS_API_URL            — base URL, e.g. https://fakastore.top/pos/index.php/api/v1
 *   POS_API_KEY            — x-api-key header value
 *   POS_LOCATION_MAP       — comma-separated `<location_id>:<canal>` pairs,
 *                            e.g. "1:pos1,2:pos2". Maps PHP POS's numeric
 *                            location_id to faka's pos1/pos2/pos channel enum.
 *
 * Same degraded-mode envelope as the ML loader: returns
 * `{ ok: false, missing }` when anything is empty so callers (cron, connector
 * factory) can write a `succeeded` no-op connector_runs row instead of paging.
 */

import type { Channel } from "@faka/schema";

export interface POSConfig {
  ok: true;
  apiUrl: string;
  apiKey: string;
  /** Map of POS location_id (numeric, as string) → faka canal. */
  locations: Map<string, Channel>;
}

export interface POSConfigMissing {
  ok: false;
  missing: string[];
}

export type LoadedPOSConfig = POSConfig | POSConfigMissing;

const VALID_POS_CANALES: ReadonlyArray<Channel> = ["pos", "pos1", "pos2"];

function parseLocationMap(raw: string): Map<string, Channel> {
  const out = new Map<string, Channel>();
  for (const pair of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [locId, canal] = pair.split(":").map((s) => s.trim());
    if (!locId || !canal) continue;
    if (!VALID_POS_CANALES.includes(canal as Channel)) continue;
    out.set(locId, canal as Channel);
  }
  return out;
}

export function loadPOSConfig(env: NodeJS.ProcessEnv = process.env): LoadedPOSConfig {
  const apiUrl = (env.POS_API_URL ?? "").trim();
  const apiKey = (env.POS_API_KEY ?? "").trim();
  const locMapRaw = (env.POS_LOCATION_MAP ?? "").trim();

  const missing: string[] = [];
  if (!apiUrl) missing.push("POS_API_URL");
  if (!apiKey) missing.push("POS_API_KEY");
  if (!locMapRaw) missing.push("POS_LOCATION_MAP");

  if (missing.length > 0) {
    return { ok: false, missing };
  }

  const locations = parseLocationMap(locMapRaw);
  if (locations.size === 0) {
    return { ok: false, missing: ["POS_LOCATION_MAP (parsed empty)"] };
  }

  return {
    ok: true,
    apiUrl: apiUrl.replace(/\/$/, ""),
    apiKey,
    locations,
  };
}
