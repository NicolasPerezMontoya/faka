/**
 * RLS / per-role view integration test — Plan 2.5.3.
 *
 * Proves ADR-002 column-projection enforcement end-to-end across all four
 * roles. For each role we:
 *
 *   1. Create a fresh auth.users row + profile with that role (service-role
 *      key), so the JWT carries the right `app_metadata.role` claim once
 *      we sign in.
 *   2. Sign in with email+password (anon key client) to obtain a real,
 *      role-stamped JWT — this is the SAME path the dashboard takes for a
 *      real user, so we exercise the live `custom_access_token_hook`.
 *   3. Issue SELECT queries against the three per-role view families
 *      (`sales_view_*`, `sale_items_view_*`, `customers_view_*`) plus the
 *      role-agnostic Hoy views (`v_hoy_per_channel` + the analista variant).
 *   4. Assert the projection contract for each role:
 *
 *        super_admin / admin → all columns visible (money + customer PII).
 *        manager             → money visible, customer PII NULLed (ADR-002).
 *        analista            → money + customer PII both NULLed; Mini-CRM
 *                              tables return zero rows; analista reads the
 *                              `v_hoy_per_channel_analista` variant which
 *                              has `ingresos` forced to NULL at SQL level.
 *
 * Gating: `TEST_SUPABASE_URL` + `TEST_SUPABASE_SERVICE_ROLE_KEY` opt-in
 * (Plan 2.5.1). Without those, `describeLive` skips and the suite exits 0.
 *
 * Cleanup: all four test users + their profiles + the seeded sales row are
 * deleted in `afterAll`. The seed uses a `RUN_TAG` prefix on every text
 * field so reruns are idempotent and won't collide with existing data
 * (the live DB carries 12 sales / 4 mappings / 6 master_products).
 *
 * Why we don't test "can analista read raw sales table directly?" — that's
 * Migration 0012's responsibility (no SELECT grant on base tables for
 * authenticated). The view layer is what the application reads, so that's
 * what we assert here. The base-table revoke is covered by migration linting
 * in F2-CC-3 / F2-CC-6.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { UserRole } from "@faka/schema";

const liveDbConfigured =
  Boolean(process.env.TEST_SUPABASE_URL) &&
  Boolean(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY);

const describeLive = liveDbConfigured ? describe : describe.skip;

const RUN_TAG = `rls-itest-${Date.now()}`;
const TEST_PASSWORD = "test-Password-2026!";

const ROLES: ReadonlyArray<UserRole> = [
  "super_admin",
  "admin",
  "manager",
  "analista",
];

interface SeededUser {
  role: UserRole;
  email: string;
  user_id: string;
  client: SupabaseClient;
}

async function createUser(
  service: SupabaseClient,
  url: string,
  anonKey: string,
  role: UserRole,
): Promise<SeededUser> {
  const email = `${RUN_TAG}-${role}@test.faka.invalid`;
  const { data: created, error: createErr } = await service.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    app_metadata: { role },
  });
  if (createErr || !created.user) {
    throw new Error(`createUser failed for ${role}: ${createErr?.message}`);
  }
  const user_id = created.user.id;

  // The trigger in some setups auto-creates a profile row; upsert to make
  // sure role is exactly what we asked for (custom_access_token_hook reads
  // public.profiles.role, NOT the app_metadata we just stamped).
  const { error: upsertErr } = await service.from("profiles").upsert(
    {
      user_id,
      email,
      role,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (upsertErr) {
    throw new Error(`profiles upsert failed for ${role}: ${upsertErr.message}`);
  }

  // Sign in via the anon client — this triggers custom_access_token_hook
  // which stamps `app_metadata.role` onto the JWT from profiles.role.
  const userClient = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signErr } = await userClient.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (signErr) {
    throw new Error(`signIn failed for ${role}: ${signErr.message}`);
  }

  return { role, email, user_id, client: userClient };
}

function viewSuffixFor(role: UserRole): "admin" | "manager" | "analista" {
  // super_admin reads the same `*_view_admin` views as admin (no separate
  // super view — ADR-002:53 — super_admin is admin+create_users + audit).
  if (role === "super_admin" || role === "admin") return "admin";
  if (role === "manager") return "manager";
  return "analista";
}

describeLive(
  "RLS + per-role views — 4-role column projection (Plan 2.5.3)",
  () => {
    let service: SupabaseClient;
    let url: string;
    let anonKey: string;
    let users: Record<UserRole, SeededUser>;
    let seededSaleId: string | null = null;

    beforeAll(async () => {
      url = process.env.TEST_SUPABASE_URL!;
      anonKey =
        process.env.TEST_SUPABASE_ANON_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
        // Fallback: the service key works as a "client" for the view-read
        // path because SECURITY INVOKER respects auth.jwt(), not the API
        // key, BUT the sign-in flow needs the anon key. If anon key is
        // missing we throw so the test fails loud instead of silently
        // testing the wrong thing.
        "";
      if (!anonKey) {
        throw new Error(
          "RLS integration test requires TEST_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) — sign-in flow needs the anon key, not service role",
        );
      }
      service = createClient(url, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // Seed one sales row + one sale_item with known $ and customer PII.
      // We control the values so the projection assertions are unambiguous.
      const externalOrderId = `${RUN_TAG}-order-001`;
      const { data: saleInsert, error: saleErr } = await service
        .from("sales")
        .insert({
          canal: "wordpress",
          external_order_id: externalOrderId,
          fecha: new Date().toISOString().slice(0, 10),
          subtotal: 100000,
          descuento: 0,
          total: 119000,
          costo_envio: 0,
          moneda: "COP",
          estado: "pagado",
          customer_name: `${RUN_TAG} Carlos Pérez`,
          customer_email: `${RUN_TAG}@privacy.invalid`,
          customer_phone: `+57-${RUN_TAG.slice(-8)}`,
          customer_city: "Bogotá",
        })
        .select("sale_id")
        .single();
      if (saleErr || !saleInsert) {
        throw new Error(`seed sales failed: ${saleErr?.message}`);
      }
      seededSaleId = saleInsert.sale_id;

      const { error: itemErr } = await service.from("sale_items").insert({
        sale_id: seededSaleId,
        product_name: `${RUN_TAG} Aceite Oliva 1L`,
        quantity: 2,
        unit_price: 50000,
        unit_cost: 30000,
        line_discount: 0,
        line_total: 100000,
        external_sku: `${RUN_TAG}-sku-001`,
      });
      if (itemErr) {
        throw new Error(`seed sale_items failed: ${itemErr.message}`);
      }

      // Create one authenticated user per role in parallel.
      const created = await Promise.all(
        ROLES.map((r) => createUser(service, url, anonKey, r)),
      );
      users = Object.fromEntries(
        created.map((u) => [u.role, u]),
      ) as Record<UserRole, SeededUser>;
    });

    afterAll(async () => {
      if (!service) return;
      // Delete users (cascades profiles via fk on delete cascade) + sales row.
      if (users) {
        await Promise.all(
          Object.values(users).map((u) =>
            service.auth.admin.deleteUser(u.user_id),
          ),
        );
      }
      if (seededSaleId) {
        await service.from("sale_items").delete().eq("sale_id", seededSaleId);
        await service.from("sales").delete().eq("sale_id", seededSaleId);
      }
    });

    it("super_admin can read all columns of sales_view_admin", async () => {
      const u = users.super_admin;
      const view = `sales_view_${viewSuffixFor(u.role)}`;
      const { data, error } = await u.client
        .from(view)
        .select("sale_id, total, customer_name, customer_email")
        .eq("sale_id", seededSaleId!)
        .single();
      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(Number(data!.total)).toBeGreaterThan(0); // money visible
      expect(data!.customer_name).toContain(RUN_TAG);
      expect(data!.customer_email).toContain(RUN_TAG);
    });

    it("admin can read all columns of sales_view_admin (same view as super_admin)", async () => {
      const u = users.admin;
      const view = `sales_view_${viewSuffixFor(u.role)}`;
      const { data, error } = await u.client
        .from(view)
        .select("sale_id, total, customer_name")
        .eq("sale_id", seededSaleId!)
        .single();
      expect(error).toBeNull();
      expect(Number(data!.total)).toBeGreaterThan(0);
      expect(data!.customer_name).toContain(RUN_TAG);
    });

    it("manager reads sales_view_manager — money visible, customer PII NULLed", async () => {
      const u = users.manager;
      const view = `sales_view_${viewSuffixFor(u.role)}`;
      const { data, error } = await u.client
        .from(view)
        .select(
          "sale_id, total, customer_name, customer_email, customer_phone, customer_city",
        )
        .eq("sale_id", seededSaleId!)
        .single();
      expect(error).toBeNull();
      // Money: still visible to manager.
      expect(Number(data!.total)).toBeGreaterThan(0);
      // Customer PII: NULL by view projection.
      expect(data!.customer_name).toBeNull();
      expect(data!.customer_email).toBeNull();
      expect(data!.customer_phone).toBeNull();
      expect(data!.customer_city).toBeNull();

      // Manager also cannot see Mini-CRM (customers_view_manager = where false).
      const { data: customers } = await u.client
        .from("customers_view_manager")
        .select("customer_id");
      expect(customers ?? []).toHaveLength(0);
    });

    it("analista reads sales_view_analista — money + PII both NULLed", async () => {
      const u = users.analista;
      const view = `sales_view_${viewSuffixFor(u.role)}`;
      const { data, error } = await u.client
        .from(view)
        .select(
          "sale_id, subtotal, total, customer_name, customer_email, customer_phone",
        )
        .eq("sale_id", seededSaleId!)
        .single();
      expect(error).toBeNull();
      // Money: NULL for analista (ADR-002 — no $ visibility).
      expect(data!.subtotal).toBeNull();
      expect(data!.total).toBeNull();
      // Customer PII: also NULL.
      expect(data!.customer_name).toBeNull();
      expect(data!.customer_email).toBeNull();
      expect(data!.customer_phone).toBeNull();

      // sale_items_view_analista: line_total / unit_price NULLed, qty visible.
      const { data: items, error: itemsErr } = await u.client
        .from("sale_items_view_analista")
        .select("quantity, unit_price, unit_cost, line_total")
        .eq("sale_id", seededSaleId!);
      expect(itemsErr).toBeNull();
      expect(items).toHaveLength(1);
      expect(Number(items![0]!.quantity)).toBeGreaterThan(0);
      expect(items![0]!.unit_price).toBeNull();
      expect(items![0]!.unit_cost).toBeNull();
      expect(items![0]!.line_total).toBeNull();

      // Hoy: analista reads `v_hoy_per_channel_analista` — `ingresos` is
      // NULL at SQL level (forced via `null::numeric` in migration 0002).
      const { data: hoyPC, error: hoyErr } = await u.client
        .from("v_hoy_per_channel_analista")
        .select("canal, ordenes, ingresos");
      expect(hoyErr).toBeNull();
      for (const r of hoyPC ?? []) {
        expect(r.ingresos).toBeNull();
      }

      // Mini-CRM zero rows for analista.
      const { data: customers } = await u.client
        .from("customers_view_analista")
        .select("customer_id");
      expect(customers ?? []).toHaveLength(0);
    });
  },
);
