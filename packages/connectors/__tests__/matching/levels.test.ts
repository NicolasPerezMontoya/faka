/**
 * Stub tests for cascade levels 1 & 3 (Plan 2.2.2 Verifies).
 *
 * These tests cover:
 *   1. `matchByBarcode` returns null for a non-existent barcode.
 *   2. `matchByBarcode` returns `{ master_sku }` for a seeded fixture row.
 *   3. `normalize()` strips diacritics + lowercases + collapses whitespace.
 *
 * (1) and (2) require a live Supabase. We gate them on a TEST_SUPABASE_URL
 * env var — if absent, those describe blocks are skipped so the test
 * file always runs green locally and in CI typecheck.
 *
 * (3) is a pure-function test and always runs.
 *
 * Cascade levels 2, 4, 5 + the orchestrator are tested in Plans 2.2.3 /
 * 2.2.4 / 2.2.5.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { matchByBarcode } from "../../src/matching/level-1-barcode.js";
import { normalize } from "../../src/matching/level-3-normalized-name.js";

const liveDbConfigured =
  Boolean(process.env.TEST_SUPABASE_URL) &&
  Boolean(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY);

describe("normalize() — pure function (always runs)", () => {
  it("strips Spanish accents and lowercases", () => {
    expect(normalize("Acéíte Olíva 1L")).toBe("aceite oliva 1l");
  });

  it("collapses internal whitespace runs to single spaces", () => {
    expect(normalize("  Crème   Brûlée  ")).toBe("creme brulee");
  });

  it("strips non-alphanumeric punctuation", () => {
    expect(normalize("Café-París, S.A. (2024)")).toBe("cafe paris s a 2024");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalize("   ")).toBe("");
  });

  it("preserves digits", () => {
    expect(normalize("Producto X-100")).toBe("producto x 100");
  });
});

const describeLive = liveDbConfigured ? describe : describe.skip;

describeLive(
  "matchByBarcode — requires TEST_SUPABASE_URL + TEST_SUPABASE_SERVICE_ROLE_KEY",
  () => {
    let supabase: SupabaseClient;

    beforeAll(() => {
      supabase = createClient(
        process.env.TEST_SUPABASE_URL!,
        process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
      );
    });

    it("returns null for a barcode that does not exist", async () => {
      const result = await matchByBarcode(
        supabase,
        "DOES-NOT-EXIST-7777777777777",
      );
      expect(result).toBeNull();
    });

    it("returns null for undefined barcode (no-signal short-circuit)", async () => {
      const result = await matchByBarcode(supabase, undefined);
      expect(result).toBeNull();
    });

    it("returns null for empty-string barcode", async () => {
      const result = await matchByBarcode(supabase, "");
      expect(result).toBeNull();
    });

    // Seeded-fixture assertion: when the integration seed (Wave 5) lands a
    // master_products row with barcode='FIXTURE-001', this returns its
    // master_sku. Until then, this is a placeholder that documents the
    // shape — uncomment + supply the fixture barcode when the seed exists.
    it.todo("returns master_sku for a seeded fixture row (Wave 5)");
  },
);
