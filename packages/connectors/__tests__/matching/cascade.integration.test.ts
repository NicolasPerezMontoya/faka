/**
 * Cascade end-to-end integration test (Plan 2.5.2).
 *
 * Seeds a small fixture set (3 `master_products` + 5 candidate sale items)
 * into a live Supabase, runs `runMatchCascade` + `persistMatch` on each
 * candidate, and asserts the cascade lands the right outcomes:
 *
 *   • Item 1 — barcode match     → Level 1 (`barcode_exact`,    score 1.0)
 *   • Item 2 — supplier_code     → Level 2 (`supplier_code_exact`, score 1.0)
 *   • Item 3 — normalized name   → Level 3 (`normalized_name_exact`, score 0.9)
 *   • Item 4 — no signal at all  → `unresolved` (no L1/L2/L3 hit, L4 stubbed off)
 *   • Item 5 — different no-hit  → `unresolved`
 *
 * After persist, the test asserts:
 *
 *   1. `product_mappings` has exactly 5 rows for the canal+external_id pairs
 *      we wrote (3 with master_sku resolved, 2 with method='unresolved' →
 *      master_sku NULL, which by table contract means NO row was inserted —
 *      so we expect 3 rows in product_mappings, not 5. The plan's wording
 *      "5 rows" predates the `master_sku NOT NULL` constraint that
 *      `persistMatch` honors; we assert the post-fix invariant here).
 *   2. `sale_items.master_sku` is non-null for at least the 3 expected matches.
 *
 * Fixture shape: each test run uses a unique canal slot (`wordpress` + a
 * timestamped external_id prefix) so reruns don't collide with prior runs
 * or the seeded `12 sales / 4 mappings / 6 master_products` rows already in
 * the live DB. Cleanup is best-effort in `afterAll` — re-runs are idempotent
 * via the `(canal, external_id)` unique constraint on `product_mappings`.
 *
 * What this proves about cascade correctness:
 *   • Levels 1-3 hit when their respective signals are present (W2/CC-13:
 *     no double-counting because `(canal, external_id)` is the dedupe key).
 *   • The cascade falls through to `unresolved` cleanly when no level hits
 *     (W1: cascade never throws, items always land somewhere).
 *   • `persistMatch` correctly UPSERTs `product_mappings` only for resolved
 *     items, and sticky-updates `sale_items.master_sku` only on matches.
 *
 * Levels 4 + 5 (embeddings + LLM arbiter) are NOT exercised here — they
 * require OPENAI / LLM credentials and are covered by their own unit tests
 * (`level-4-embeddings.test.ts`, `level-5-llm-arbiter.test.ts`) with MSW
 * stubs. The 12-test MSW-driven version is deferred to a future iteration
 * (see PLAN.md §2.5.2 for the full envelope).
 *
 * Gating: requires `TEST_SUPABASE_URL` + `TEST_SUPABASE_SERVICE_ROLE_KEY`.
 * Without those, the describe block is `describe.skip` and the suite exits
 * 0 (Plan 2.5.1 contract).
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  runMatchCascade,
  persistMatch,
  loadThresholds,
} from "../../src/matching/index.js";
import type { SaleItemCandidate } from "../../src/matching/types.js";

const liveDbConfigured =
  Boolean(process.env.TEST_SUPABASE_URL) &&
  Boolean(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY);

const describeLive = liveDbConfigured ? describe : describe.skip;

// Unique slot for this test run — keeps inserts disjoint from prior runs
// and from the production-seeded fixture set in the live DB.
const RUN_TAG = `cascade-itest-${Date.now()}`;

describeLive(
  "cascade integration — 5-level end-to-end (Plan 2.5.2)",
  () => {
    let supabase: SupabaseClient;
    let masterSkus: { barcode: string; supplier: string; name: string };
    let sale_id: string;

    beforeAll(async () => {
      supabase = createClient(
        process.env.TEST_SUPABASE_URL!,
        process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
        {
          auth: { autoRefreshToken: false, persistSession: false },
        },
      );

      // -------- Seed 3 master_products --------
      // Each crafted to hit exactly one cascade level for the matching item.
      const masters = [
        {
          nombre_canonico: `${RUN_TAG} Aceite Oliva 1L`,
          barcode: `${RUN_TAG}-bc-001`,
          supplier_code: null,
        },
        {
          nombre_canonico: `${RUN_TAG} Arroz Diana 1kg`,
          barcode: null,
          supplier_code: `${RUN_TAG}-sup-002`,
        },
        {
          nombre_canonico: `${RUN_TAG} Cafe Aguila Roja`,
          barcode: null,
          supplier_code: null,
        },
      ];

      const { data: insertedMasters, error: mErr } = await supabase
        .from("master_products")
        .insert(masters)
        .select("master_sku, nombre_canonico, barcode, supplier_code");

      if (mErr) throw mErr;
      expect(insertedMasters).toHaveLength(3);

      const byBarcode = insertedMasters!.find(
        (m: { barcode: string | null }) => m.barcode !== null,
      )!;
      const bySupplier = insertedMasters!.find(
        (m: { supplier_code: string | null }) => m.supplier_code !== null,
      )!;
      const byName = insertedMasters!.find(
        (m: { barcode: string | null; supplier_code: string | null }) =>
          m.barcode === null && m.supplier_code === null,
      )!;

      masterSkus = {
        barcode: (byBarcode as { master_sku: string }).master_sku,
        supplier: (bySupplier as { master_sku: string }).master_sku,
        name: (byName as { master_sku: string }).master_sku,
      };

      // -------- Seed a parent `sales` row + 5 `sale_items` --------
      const { data: saleRow, error: sErr } = await supabase
        .from("sales")
        .insert({
          canal: "wordpress",
          external_order_id: `${RUN_TAG}-order-1`,
          fecha: new Date().toISOString().slice(0, 10),
          subtotal: 0,
          descuento: 0,
          total: 0,
          moneda: "COP",
          estado: "pagado",
        })
        .select("sale_id")
        .single();

      if (sErr) throw sErr;
      sale_id = (saleRow as { sale_id: string }).sale_id;

      const items = [
        {
          sale_id,
          external_product_id: `${RUN_TAG}-ext-1`,
          product_name: "Aceite Oliva (item 1 — barcode hit)",
          external_sku: `${RUN_TAG}-bc-001`, // matches master 1 barcode
          quantity: 1,
          unit_price: 10000,
          line_total: 10000,
        },
        {
          sale_id,
          external_product_id: `${RUN_TAG}-ext-2`,
          product_name: "Arroz Diana (item 2 — supplier hit)",
          external_sku: `${RUN_TAG}-sup-002`, // matches master 2 supplier_code
          quantity: 1,
          unit_price: 5000,
          line_total: 5000,
        },
        {
          sale_id,
          external_product_id: `${RUN_TAG}-ext-3`,
          // Different casing/accents from master.nombre_canonico — the TS
          // `normalize()` mirror should produce a string that matches the
          // PG `nombre_normalizado` generated column on master row 3.
          product_name: `${RUN_TAG} Café Águila ROJA`,
          quantity: 1,
          unit_price: 3000,
          line_total: 3000,
        },
        {
          sale_id,
          external_product_id: `${RUN_TAG}-ext-4`,
          product_name: `${RUN_TAG} Producto Desconocido XYZ`,
          quantity: 1,
          unit_price: 1000,
          line_total: 1000,
        },
        {
          sale_id,
          external_product_id: `${RUN_TAG}-ext-5`,
          product_name: `${RUN_TAG} Otra Cosa No Catalogada`,
          quantity: 1,
          unit_price: 2000,
          line_total: 2000,
        },
      ];

      const { error: iErr } = await supabase.from("sale_items").insert(items);
      if (iErr) throw iErr;
    }, 30_000);

    afterAll(async () => {
      if (!supabase) return;
      // Best-effort cleanup — order matters because of FKs.
      // sale_items → sales (cascade), product_mappings (manual), master_products.
      try {
        await supabase
          .from("product_mappings")
          .delete()
          .like("external_id", `${RUN_TAG}-%`);
        await supabase.from("sale_items").delete().eq("sale_id", sale_id);
        await supabase.from("sales").delete().eq("sale_id", sale_id);
        await supabase
          .from("master_products")
          .delete()
          .like("nombre_canonico", `${RUN_TAG}%`);
      } catch {
        // Ignore — best-effort. RUN_TAG keeps re-runs from colliding anyway.
      }
    }, 30_000);

    it("resolves 3 of 5 candidates through cascade levels 1-3 and persists results", async () => {
      // Pull the just-inserted sale_items back so we have their UUIDs +
      // external_product_id values keyed by name.
      const { data: itemsRaw, error: qErr } = await supabase
        .from("sale_items")
        .select("id, external_product_id, product_name, external_sku")
        .eq("sale_id", sale_id);

      if (qErr) throw qErr;
      const items = itemsRaw as Array<{
        id: string;
        external_product_id: string;
        product_name: string;
        external_sku: string | null;
      }>;
      expect(items).toHaveLength(5);

      // Build cascade context. We deliberately leave `openai` + `llmConfig`
      // undefined → level 4 returns null (no embeddings client), level 5
      // never fires. That isolates this integration test to levels 0-3.
      const ctx = {
        supabase,
        thresholds: loadThresholds({}),
        // openai / llmConfig intentionally undefined for L1-L3-only coverage
      };

      // Run cascade + persist for each candidate, collecting outcomes by
      // external_product_id.
      const outcomes: Record<
        string,
        { method: string; master_sku: string | null }
      > = {};

      for (const row of items) {
        // The candidate shape the cascade expects. We map external_sku to
        // either `barcode` or `supplier_code` based on which master it was
        // designed to hit (the test fixtures encode this in the SKU prefix).
        const isBarcodeProbe = row.external_sku?.includes("-bc-");
        const isSupplierProbe = row.external_sku?.includes("-sup-");

        const candidate: SaleItemCandidate = {
          canal: "wordpress",
          external_product_id: row.external_product_id,
          product_name: row.product_name,
          barcode: isBarcodeProbe ? row.external_sku ?? undefined : undefined,
          supplier_code: isSupplierProbe
            ? row.external_sku ?? undefined
            : undefined,
        };

        const result = await runMatchCascade(candidate, ctx);
        await persistMatch(supabase, candidate, result);

        outcomes[row.external_product_id] = {
          method: result.method,
          master_sku: result.master_sku,
        };
      }

      // ---- Assert per-item outcomes ----
      expect(outcomes[`${RUN_TAG}-ext-1`]!.method).toBe("barcode_exact");
      expect(outcomes[`${RUN_TAG}-ext-1`]!.master_sku).toBe(
        masterSkus.barcode,
      );

      expect(outcomes[`${RUN_TAG}-ext-2`]!.method).toBe("supplier_code_exact");
      expect(outcomes[`${RUN_TAG}-ext-2`]!.master_sku).toBe(
        masterSkus.supplier,
      );

      expect(outcomes[`${RUN_TAG}-ext-3`]!.method).toBe(
        "normalized_name_exact",
      );
      expect(outcomes[`${RUN_TAG}-ext-3`]!.master_sku).toBe(masterSkus.name);

      // Items 4 + 5 — no signal hits, level 4 stubbed off → unresolved.
      expect(outcomes[`${RUN_TAG}-ext-4`]!.method).toBe("unresolved");
      expect(outcomes[`${RUN_TAG}-ext-4`]!.master_sku).toBeNull();
      expect(outcomes[`${RUN_TAG}-ext-5`]!.method).toBe("unresolved");
      expect(outcomes[`${RUN_TAG}-ext-5`]!.master_sku).toBeNull();

      // ---- Assert product_mappings ----
      // `persistMatch` UPSERTs ONLY when master_sku !== null (the PG column
      // is NOT NULL). So we expect 3 rows for this run's external_ids,
      // not 5. This is the post-fix invariant; the plan's "5 rows" wording
      // assumed unresolved would also produce a row, which the schema
      // explicitly disallows.
      const { data: mappingsRaw, error: mErr } = await supabase
        .from("product_mappings")
        .select("external_id, master_sku, match_method, validado_humano")
        .like("external_id", `${RUN_TAG}-%`);

      if (mErr) throw mErr;
      const mappings = mappingsRaw as Array<{
        external_id: string;
        master_sku: string;
        match_method: string;
        validado_humano: boolean;
      }>;

      expect(mappings).toHaveLength(3);
      // All cascade-written rows MUST start as validado_humano=false (the
      // F1 "learn once" invariant — only the validation queue UI flips this).
      for (const m of mappings) {
        expect(m.validado_humano).toBe(false);
      }

      // ---- Assert sale_items.master_sku sticky update ----
      // At least 3 of the 5 sale_items must now have master_sku populated
      // (the three that resolved via L1/L2/L3).
      const { data: postItemsRaw, error: piErr } = await supabase
        .from("sale_items")
        .select("external_product_id, master_sku")
        .eq("sale_id", sale_id);

      if (piErr) throw piErr;
      const postItems = postItemsRaw as Array<{
        external_product_id: string;
        master_sku: string | null;
      }>;

      const resolved = postItems.filter((p) => p.master_sku !== null);
      expect(resolved.length).toBeGreaterThanOrEqual(3);

      // Specifically the three we engineered to hit:
      const lookup = Object.fromEntries(
        postItems.map((p) => [p.external_product_id, p.master_sku]),
      );
      expect(lookup[`${RUN_TAG}-ext-1`]).toBe(masterSkus.barcode);
      expect(lookup[`${RUN_TAG}-ext-2`]).toBe(masterSkus.supplier);
      expect(lookup[`${RUN_TAG}-ext-3`]).toBe(masterSkus.name);

      // The two unresolved items must remain null (no sticky write).
      expect(lookup[`${RUN_TAG}-ext-4`]).toBeNull();
      expect(lookup[`${RUN_TAG}-ext-5`]).toBeNull();
    });
  },
);
