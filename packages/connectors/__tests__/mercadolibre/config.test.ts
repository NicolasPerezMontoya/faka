/**
 * Tests for `packages/connectors/src/mercadolibre/config.ts` (Plan 2.1.2.3).
 *
 * Coverage matrix:
 *   1. Full env (all four vars + ML_SITE_ID) → ok:true with all fields.
 *   2. Missing any required → ok:false, reason:"not_configured", missing[].
 *   3. Whitespace-only values count as missing.
 *   4. ML_CLIENT_ID must be numeric — passes "3933497047128728".
 *   5. ML_CLIENT_ID alpha → ok:false with "must be a numeric string".
 *   6. ML_REDIRECT_URI http:// → ok:false with "must be https".
 *   7. ML_REDIRECT_URI non-URL → ok:false with "must be a parseable URL".
 *   8. ML_REDIRECT_URI unusual path → ok:true (warning logged, not rejected).
 *   9. ML_SITE_ID default "MCO" when env unset.
 *   10. getMLConnectionStatus:
 *       - configured + connected when token row exists.
 *       - configured but not connected when oauth_tokens empty.
 *       - never returns access_token.
 */

import { describe, it, expect, vi } from "vitest";
import {
  loadMercadoLibreConfig,
  getMLConnectionStatus,
} from "../../src/mercadolibre/config.js";

const FULL_ENV = {
  ML_CLIENT_ID: "3933497047128728",
  ML_CLIENT_SECRET: "test_secret_aaa",
  ML_REDIRECT_URI: "https://orchestrator.example.com/oauth/mercadolibre/callback",
  ML_WEBHOOK_SECRET: "webhook_secret_bbb",
  ML_SITE_ID: "MCO",
} as NodeJS.ProcessEnv;

describe("loadMercadoLibreConfig — happy path", () => {
  it("returns ok:true with all four fields when the env is complete", () => {
    const result = loadMercadoLibreConfig(FULL_ENV);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cfg.clientId).toBe("3933497047128728");
      expect(result.cfg.clientSecret).toBe("test_secret_aaa");
      expect(result.cfg.redirectUri).toBe(
        "https://orchestrator.example.com/oauth/mercadolibre/callback",
      );
      expect(result.cfg.webhookSecret).toBe("webhook_secret_bbb");
      expect(result.cfg.siteId).toBe("MCO");
    }
  });

  it("accepts the real cliente client_id (numeric 16-digit)", () => {
    const result = loadMercadoLibreConfig(FULL_ENV);
    expect(result.ok).toBe(true);
  });

  it("defaults siteId to 'MCO' when ML_SITE_ID env is unset", () => {
    const env = { ...FULL_ENV } as NodeJS.ProcessEnv;
    delete env.ML_SITE_ID;
    const result = loadMercadoLibreConfig(env);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.cfg.siteId).toBe("MCO");
  });
});

describe("loadMercadoLibreConfig — degraded mode", () => {
  it("returns ok:false reason:not_configured when ML_CLIENT_ID is missing", () => {
    const env = { ...FULL_ENV } as NodeJS.ProcessEnv;
    delete env.ML_CLIENT_ID;
    const result = loadMercadoLibreConfig(env);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_configured");
      expect(result.missing).toContain("ML_CLIENT_ID");
    }
  });

  it("flags all four when none are present", () => {
    const result = loadMercadoLibreConfig({} as NodeJS.ProcessEnv);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual(
        expect.arrayContaining([
          "ML_CLIENT_ID",
          "ML_CLIENT_SECRET",
          "ML_REDIRECT_URI",
          "ML_WEBHOOK_SECRET",
        ]),
      );
    }
  });

  it("treats whitespace-only values as missing", () => {
    const env = { ...FULL_ENV, ML_CLIENT_SECRET: "   " } as NodeJS.ProcessEnv;
    const result = loadMercadoLibreConfig(env);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContain("ML_CLIENT_SECRET");
    }
  });

  it("rejects non-numeric ML_CLIENT_ID with descriptive marker", () => {
    const env = { ...FULL_ENV, ML_CLIENT_ID: "abc123" } as NodeJS.ProcessEnv;
    const result = loadMercadoLibreConfig(env);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing.some((m) => m.startsWith("ML_CLIENT_ID"))).toBe(true);
      expect(result.missing.some((m) => /numeric/.test(m))).toBe(true);
    }
  });

  it("rejects http:// redirect URI with descriptive marker", () => {
    const env = {
      ...FULL_ENV,
      ML_REDIRECT_URI: "http://orchestrator.example.com/oauth/mercadolibre/callback",
    } as NodeJS.ProcessEnv;
    const result = loadMercadoLibreConfig(env);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing.some((m) => /must be https/.test(m))).toBe(true);
    }
  });

  it("rejects unparseable redirect URI", () => {
    const env = { ...FULL_ENV, ML_REDIRECT_URI: "not a url" } as NodeJS.ProcessEnv;
    const result = loadMercadoLibreConfig(env);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing.some((m) => /parseable URL/.test(m))).toBe(true);
    }
  });

  it("WARNS but accepts unusual redirect path (e.g. /custom-cb)", () => {
    const env = {
      ...FULL_ENV,
      ML_REDIRECT_URI: "https://orchestrator.example.com/some/custom-cb",
    } as NodeJS.ProcessEnv;
    const logger = { warn: vi.fn() };
    const result = loadMercadoLibreConfig(env, { logger });
    expect(result.ok).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      "ml.config.redirect_path_unusual",
      expect.objectContaining({ pathname: "/some/custom-cb" }),
    );
  });
});

// -----------------------------------------------------------------------------
// getMLConnectionStatus
// -----------------------------------------------------------------------------

function makeStatusMock(opts: { tokenRow?: { user_id: string } | null } = {}) {
  return {
    from(_table: string) {
      return {
        select: () => ({
          eq: () => ({
            limit: () => ({
              maybeSingle: async () => ({
                data: opts.tokenRow ?? null,
                error: null,
              }),
            }),
          }),
        }),
      };
    },
  };
}

describe("getMLConnectionStatus", () => {
  it("returns configured:true + connected:true when token row exists", async () => {
    const supabase = makeStatusMock({ tokenRow: { user_id: "USR_99" } });
    const status = await getMLConnectionStatus(supabase as never, FULL_ENV);
    expect(status.configured).toBe(true);
    expect(status.connected).toBe(true);
    expect(status.user_id).toBe("USR_99");
  });

  it("returns configured:true + connected:false when no token row", async () => {
    const supabase = makeStatusMock({ tokenRow: null });
    const status = await getMLConnectionStatus(supabase as never, FULL_ENV);
    expect(status.configured).toBe(true);
    expect(status.connected).toBe(false);
    expect(status.user_id).toBeUndefined();
  });

  it("returns configured:false when env is incomplete (even if connected)", async () => {
    const env = { ...FULL_ENV } as NodeJS.ProcessEnv;
    delete env.ML_CLIENT_SECRET;
    const supabase = makeStatusMock({ tokenRow: { user_id: "USR_LEGACY" } });
    const status = await getMLConnectionStatus(supabase as never, env);
    expect(status.configured).toBe(false);
    expect(status.connected).toBe(true);
    expect(status.user_id).toBe("USR_LEGACY");
  });

  it("never returns access_token or refresh_token (CC-11)", async () => {
    const supabase = makeStatusMock({ tokenRow: { user_id: "USR_X" } });
    const status = await getMLConnectionStatus(supabase as never, FULL_ENV);
    expect(Object.keys(status)).not.toContain("access_token");
    expect(Object.keys(status)).not.toContain("refresh_token");
  });
});
