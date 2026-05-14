/**
 * Hoy views integration test — Plan 2.5.3.
 *
 * Drives the four `v_hoy_*` SECURITY INVOKER views with a known fixture
 * (3 sales today across 3 canales + 2 sales yesterday) and asserts the
 * shape + math of each view against the fixture.
 *
 * Views under test (all from migration 20260601000002_hoy_views.sql):
 *
 *   • v_hoy_totals           — sum(line_total) for today, units, distinct orders.
 *   • v_hoy_per_channel      — group by canal for today; ordered by ingresos desc.
 *   • v_hoy_top_products     — top 10 by ingresos, only matched items (master_sku NOT NULL).
 *   • v_hoy_last_hour        — rows with created_at >= now()-1h, max 50.
 *
 * Plus a structural CC-12 lint (every `create view` ↔ `security_invoker = true`).
 *
 * Math assertions are RUN-SCOPED — the live DB carries a baseline (12 sales /
 * 4 mappings / 6 master_products from the seed); we add OUR fixture on top
 * and assert deltas (after - before) rather than absolute values. That keeps
 * the suite immune to whatever sat in the DB pre-run.
 *
 * Gating: `TEST_SUPABASE_URL` + `TEST_SUPABASE_SERVICE_ROLE_KEY` opt-in
 * (Plan 2.5.1). `describeLive` skips cleanly when unset.
 *
 * Cleanup: every seeded row is tagged `${RUN_TAG}` in `external_order_id`
 * + `product_name` so `afterAll` can `delete .like(...)` without colliding
 * with the production seed.
 *
 * Timezone note: the views compute "today" as
 * `(now() at time zone 'America/Bogota')::date`. We deliberately set
 * `created_at` to NOW (`new Date()`) and `fecha` to the Bogotá-local date,
 * which is what the Hoy receiver does in real life. This is Pitfall 10's
 * mitigation: never store a Bogotá-local date as if it were UTC. If the
 * test runs at 23:30 Bogotá / 04:30 UTC next day, the row's `fecha` is
 * still TODAY in Bogotá, which is what the view filters on.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ESM `__dirname` shim — the dashboard package is `"type": "module"` and
// the Node-typed global `__dirname` is not defined in ESM mode. We rename
// to `here` to avoid colliding with TypeScript's global declaration.
const here = dirname(fileURLToPath(import.meta.url));

const liveDbConfigured =
  Boolean(process.env.TEST_SUPABASE_URL) &&
  Boolean(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY);

const describeLive = liveDbConfigured ? describe : describe.skip;

const RUN_TAG = `hoy-itest-${Date.now()}`;

function bogotaToday(): string {
  // Bogotá is UTC-5 year-round (no DST). YYYY-MM-DD in Bogotá local time.
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }),
  )
    .toISOString()
    .slice(0, 10);
}

interface TotalsRow {
  ingresos_hoy: string | number;
  unidades_hoy: string | number;
  ordenes_hoy: string | number;
}

interface PerChannelRow {
  canal: string;
  ordenes: string | number;
  ingresos: string | number;
}

interface TopProductRow {
  master_sku: string | null;
  ingresos: string | number;
}

interface LastHourRow {
  sale_id: string;
  canal: string;
  created_at: string;
}

describeLive(
  "Hoy views — math + shape + CC-12 lint (Plan 2.5.3)",
  () => {
    let supabase: SupabaseClient;
    let seededSaleIds: string[] = [];
    let masterSku: string | null = null;

    // Snapshot baselines so we can assert deltas instead of absolutes.
    let totalsBefore: TotalsRow | null = null;
    let perChannelBefore: PerChannelRow[] = [];
    let lastHourCountBefore = 0;

    beforeAll(async () => {
      supabase = createClient(
        process.env.TEST_SUPABASE_URL!,
        process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );

      // ── snapshot baselines ────────────────────────────────────────────
      const { data: tBefore } = await supabase
        .from("v_hoy_totals")
        .select("*")
        .single();
      totalsBefore = tBefore as TotalsRow | null;
      const { data: pcBefore } = await supabase
        .from("v_hoy_per_channel")
        .select("*");
      perChannelBefore = (pcBefore as PerChannelRow[]) ?? [];
      const { count: lhBefore } = await supabase
        .from("v_hoy_last_hour")
        .select("*", { count: "exact", head: true });
      lastHourCountBefore = lhBefore ?? 0;

      // ── seed a master_product so top_products can show OUR row ────────
      masterSku = `${RUN_TAG}-sku-master`;
      const { error: mpErr } = await supabase.from("master_products").insert({
        master_sku: masterSku,
        nombre_canonico: `${RUN_TAG} Producto Fixture`,
        brand: "TestBrand",
      });
      if (mpErr) {
        throw new Error(`seed master_products failed: ${mpErr.message}`);
      }

      // ── seed sales ────────────────────────────────────────────────────
      // 3 today across 3 canales (wordpress, csv-upload, mercadolibre)
      // 2 yesterday on wordpress (should NOT appear in today's views).
      const today = bogotaToday();
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      const salesToInsert = [
        {
          canal: "wordpress",
          external_order_id: `${RUN_TAG}-wp-001`,
          fecha: today,
          subtotal: 100000,
          total: 119000,
          line_total: 119000,
          unit_price: 119000,
          quantity: 1,
        },
        {
          canal: "csv-upload",
          external_order_id: `${RUN_TAG}-csv-001`,
          fecha: today,
          subtotal: 50000,
          total: 50000,
          line_total: 50000,
          unit_price: 50000,
          quantity: 1,
        },
        {
          canal: "mercadolibre",
          external_order_id: `${RUN_TAG}-ml-001`,
          fecha: today,
          subtotal: 200000,
          total: 238000,
          line_total: 238000,
          unit_price: 119000,
          quantity: 2,
        },
        {
          canal: "wordpress",
          external_order_id: `${RUN_TAG}-wp-yesterday-001`,
          fecha: yesterday,
          subtotal: 999999,
          total: 999999,
          line_total: 999999,
          unit_price: 999999,
          quantity: 1,
        },
        {
          canal: "wordpress",
          external_order_id: `${RUN_TAG}-wp-yesterday-002`,
          fecha: yesterday,
          subtotal: 999999,
          total: 999999,
          line_total: 999999,
          unit_price: 999999,
          quantity: 1,
        },
      ];

      for (const fixture of salesToInsert) {
        const { data: sale, error: saleErr } = await supabase
          .from("sales")
          .insert({
            canal: fixture.canal as
              | "wordpress"
              | "mercadolibre"
              | "csv-upload",
            external_order_id: fixture.external_order_id,
            fecha: fixture.fecha,
            subtotal: fixture.subtotal,
            descuento: 0,
            total: fixture.total,
            costo_envio: 0,
            moneda: "COP",
            estado: "pagado",
          })
          .select("sale_id")
          .single();
        if (saleErr || !sale) {
          throw new Error(
            `seed sales failed for ${fixture.external_order_id}: ${saleErr?.message}`,
          );
        }
        seededSaleIds.push(sale.sale_id);

        // Each sale gets 2 sale_items: one matched (master_sku set) so it
        // shows up in v_hoy_top_products, one unmatched (null master_sku).
        const isToday = fixture.fecha === today;
        await supabase.from("sale_items").insert([
          {
            sale_id: sale.sale_id,
            master_sku: isToday ? masterSku : null,
            product_name: `${RUN_TAG} matched item`,
            external_sku: `${RUN_TAG}-sku-${fixture.external_order_id}-a`,
            quantity: fixture.quantity,
            unit_price: fixture.unit_price,
            line_discount: 0,
            line_total: fixture.line_total,
          },
          {
            sale_id: sale.sale_id,
            master_sku: null,
            product_name: `${RUN_TAG} unmatched item`,
            external_sku: `${RUN_TAG}-sku-${fixture.external_order_id}-b`,
            quantity: 1,
            unit_price: 1000,
            line_discount: 0,
            line_total: 1000,
          },
        ]);
      }
    });

    afterAll(async () => {
      if (!supabase) return;
      // Order matters: sale_items first (FK to sales), then sales, then master.
      for (const id of seededSaleIds) {
        await supabase.from("sale_items").delete().eq("sale_id", id);
      }
      for (const id of seededSaleIds) {
        await supabase.from("sales").delete().eq("sale_id", id);
      }
      if (masterSku) {
        await supabase
          .from("master_products")
          .delete()
          .eq("master_sku", masterSku);
      }
    });

    it("v_hoy_totals reflects today's seeded sales (delta math, ignores yesterday)", async () => {
      const { data, error } = await supabase
        .from("v_hoy_totals")
        .select("ingresos_hoy, unidades_hoy, ordenes_hoy")
        .single();
      expect(error).toBeNull();
      expect(data).not.toBeNull();

      const before = totalsBefore!;
      const after = data as TotalsRow;

      // 3 today: line_totals are 119000 + 50000 + 238000 = 407000.
      // Plus the unmatched 1000-each items × 3 today = 3000.
      // Total delta: 410000.
      const ingresosDelta =
        Number(after.ingresos_hoy) - Number(before?.ingresos_hoy ?? 0);
      expect(ingresosDelta).toBeCloseTo(410000, 0);

      // Orders delta: 3 (we added 3 today; yesterday's 2 don't count).
      const ordenesDelta =
        Number(after.ordenes_hoy) - Number(before?.ordenes_hoy ?? 0);
      expect(ordenesDelta).toBe(3);

      // Units delta: quantities (1 + 1 + 2) + (1+1+1 unmatched) = 7.
      const unidadesDelta =
        Number(after.unidades_hoy) - Number(before?.unidades_hoy ?? 0);
      expect(unidadesDelta).toBe(7);
    });

    it("v_hoy_per_channel has one row per today's canal, ordered by ingresos desc", async () => {
      const { data, error } = await supabase
        .from("v_hoy_per_channel")
        .select("canal, ordenes, ingresos");
      expect(error).toBeNull();

      const rows = (data as PerChannelRow[]) ?? [];

      // Ordering check (only on the rows that have ingresos > 0 — yesterday
      // rows are filtered out at view level).
      const ingresosList = rows.map((r) => Number(r.ingresos));
      const sorted = [...ingresosList].sort((a, b) => b - a);
      expect(ingresosList).toEqual(sorted);

      // Find OUR three rows by canal — they may share canal with baseline,
      // so we compare deltas in ordenes against the baseline snapshot.
      const beforeByCanal = new Map(
        perChannelBefore.map((r) => [
          r.canal,
          { ordenes: Number(r.ordenes), ingresos: Number(r.ingresos) },
        ]),
      );
      const afterByCanal = new Map(
        rows.map((r) => [
          r.canal,
          { ordenes: Number(r.ordenes), ingresos: Number(r.ingresos) },
        ]),
      );

      for (const canal of ["wordpress", "csv-upload", "mercadolibre"]) {
        const before = beforeByCanal.get(canal) ?? {
          ordenes: 0,
          ingresos: 0,
        };
        const after = afterByCanal.get(canal);
        expect(after).toBeDefined();
        // Each of our 3 canales got +1 order today.
        expect(after!.ordenes - before.ordenes).toBe(1);
      }
    });

    it("v_hoy_top_products returns ≤10 rows, all with non-null master_sku, includes our fixture", async () => {
      const { data, error } = await supabase
        .from("v_hoy_top_products")
        .select("master_sku, ingresos");
      expect(error).toBeNull();
      const rows = (data as TopProductRow[]) ?? [];

      expect(rows.length).toBeLessThanOrEqual(10);
      for (const r of rows) {
        expect(r.master_sku).not.toBeNull();
      }

      // Our fixture master_sku should appear (3 sales today all referenced it).
      const ours = rows.find((r) => r.master_sku === masterSku);
      expect(ours).toBeDefined();
    });

    it("v_hoy_last_hour shows our seeded sales (all created_at = now)", async () => {
      const { data, error, count } = await supabase
        .from("v_hoy_last_hour")
        .select("sale_id, canal, created_at", { count: "exact" });
      expect(error).toBeNull();
      const rows = (data as LastHourRow[]) ?? [];

      // 5 seeded sales total (3 today + 2 "yesterday" — created_at is still
      // now() since we didn't override it). All should appear in last-hour.
      const delta = (count ?? 0) - lastHourCountBefore;
      expect(delta).toBe(5);

      // Every row's created_at is within the last hour by definition (view
      // contract). Sanity check the most recent one.
      const oneHourAgoMs = Date.now() - 60 * 60 * 1000;
      for (const r of rows) {
        expect(new Date(r.created_at).getTime()).toBeGreaterThanOrEqual(
          oneHourAgoMs,
        );
      }

      // Limit guard: max 50 rows per view contract.
      expect(rows.length).toBeLessThanOrEqual(50);
    });

    it("CC-12 lint: every `create view` in the hoy migration declares security_invoker = true", () => {
      // Structural assertion — keeps the migration honest even if a future
      // refactor adds a sixth view. F2-CC-7 covers the same invariant at the
      // phase-cross-cutting level.
      const migrationPath = resolve(
        here,
        "../../../../packages/db/supabase/migrations/20260601000002_hoy_views.sql",
      );
      const sql = readFileSync(migrationPath, "utf-8");
      const createCount = (sql.match(/create view/gi) ?? []).length;
      const securityInvokerCount = (sql.match(/security_invoker\s*=\s*true/gi) ?? [])
        .length;
      expect(createCount).toBeGreaterThan(0);
      expect(securityInvokerCount).toBe(createCount);
    });
  },
);
