// /ventas — historical sales explorer.
// Server Component reads sales + sale_items via SECURITY INVOKER paths
// (the user's role-scoped Supabase client). URL params drive filtering so
// the view is shareable / refresh-safe.

import { headers } from "next/headers";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
} from "@faka/ui";
import type { UserRole } from "@faka/schema";
import { createClient } from "@/lib/supabase/server";
import { VentasSummary } from "./_components/ventas-summary.js";

export const dynamic = "force-dynamic";

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const NUM = new Intl.NumberFormat("es-CO");

const CANAL_LABELS: Record<string, string> = {
  wordpress: "WordPress",
  mercadolibre: "Mercado Libre",
  dropi: "Dropi",
  pos: "POS",
  whatsapp: "WhatsApp",
  falabella: "Falabella",
  "csv-upload": "CSV manual",
};

const ESTADO_VARIANT: Record<string, "ok" | "muted" | "warn" | "err"> = {
  pagado: "ok",
  pendiente: "warn",
  parcial: "warn",
  cancelado: "err",
  devuelto: "err",
};

const PAGE_SIZE = 50;

interface SearchParams {
  from?: string;
  to?: string;
  canal?: string;
  estado?: string;
  q?: string;
  page?: string;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDateOr(s: string | undefined, fallback: Date): Date {
  if (!s) return fallback;
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? fallback : d;
}

export default async function VentasPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const role = headers().get("x-user-role") as UserRole | null;
  const showMoney = role !== "analista";

  // ── Filters ──────────────────────────────────────────────────────────────
  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setDate(defaultFrom.getDate() - 30);
  const from = parseDateOr(searchParams.from, defaultFrom);
  const to = parseDateOr(searchParams.to, today);
  const canalFilter = (searchParams.canal ?? "").trim();
  const estadoFilter = (searchParams.estado ?? "").trim();
  const q = (searchParams.q ?? "").trim();
  const page = Math.max(1, Number(searchParams.page ?? 1));
  const offset = (page - 1) * PAGE_SIZE;

  // ── Query ────────────────────────────────────────────────────────────────
  const supabase = createClient();

  let query = supabase
    .from("sales")
    .select(
      "sale_id, canal, external_order_id, fecha, hora, total, estado, customer_name, customer_city, notes",
      { count: "exact" },
    )
    .gte("fecha", toISODate(from))
    .lte("fecha", toISODate(to))
    .order("fecha", { ascending: false })
    .order("hora", { ascending: false, nullsFirst: false });

  if (canalFilter) query = query.eq("canal", canalFilter as never);
  if (estadoFilter) query = query.eq("estado", estadoFilter as never);
  if (q) {
    // Search across external_order_id and customer_name.
    query = query.or(`external_order_id.ilike.%${q}%,customer_name.ilike.%${q}%`);
  }

  query = query.range(offset, offset + PAGE_SIZE - 1);
  const { data: salesRaw, error, count: totalCount } = await query;
  const sales = salesRaw ?? [];

  // ── Item counts for the visible page (one batch query) ───────────────────
  const visibleIds = sales.map((s) => s.sale_id as string);
  const itemCountBySale = new Map<string, number>();
  if (visibleIds.length > 0) {
    const { data: items } = await supabase
      .from("sale_items")
      .select("sale_id, quantity")
      .in("sale_id", visibleIds);
    for (const it of items ?? []) {
      const sid = it.sale_id as string;
      itemCountBySale.set(
        sid,
        (itemCountBySale.get(sid) ?? 0) + Number(it.quantity ?? 0),
      );
    }
  }

  const totalPages = Math.max(1, Math.ceil((totalCount ?? sales.length) / PAGE_SIZE));

  // ── Helpers to rebuild URLs ──────────────────────────────────────────────
  function buildHref(overrides: Partial<SearchParams>): string {
    const p = new URLSearchParams();
    const next: SearchParams = {
      from: toISODate(from),
      to: toISODate(to),
      canal: canalFilter || undefined,
      estado: estadoFilter || undefined,
      q: q || undefined,
      page: page > 1 ? String(page) : undefined,
      ...overrides,
    };
    for (const [k, v] of Object.entries(next)) {
      if (v !== undefined && v !== "" && v !== null) p.set(k, String(v));
    }
    const qs = p.toString();
    return qs ? `/ventas?${qs}` : "/ventas";
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Ventas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Explorador histórico · {toISODate(from)} → {toISODate(to)}
          {canalFilter ? ` · ${CANAL_LABELS[canalFilter] ?? canalFilter}` : ""}
        </p>
      </header>

      {/* ── Filters form ─────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4">
          <form
            method="get"
            action="/ventas"
            className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end"
          >
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                Desde
              </label>
              <input
                type="date"
                name="from"
                defaultValue={toISODate(from)}
                className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                Hasta
              </label>
              <input
                type="date"
                name="to"
                defaultValue={toISODate(to)}
                className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                Canal
              </label>
              <select
                name="canal"
                defaultValue={canalFilter}
                className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm"
              >
                <option value="">Todos</option>
                {Object.entries(CANAL_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                Estado
              </label>
              <select
                name="estado"
                defaultValue={estadoFilter}
                className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm"
              >
                <option value="">Todos</option>
                <option value="pagado">Pagado</option>
                <option value="pendiente">Pendiente</option>
                <option value="parcial">Parcial</option>
                <option value="cancelado">Cancelado</option>
                <option value="devuelto">Devuelto</option>
              </select>
            </div>
            <div className="md:col-span-1">
              <label className="block text-xs text-muted-foreground mb-1">
                Búsqueda
              </label>
              <input
                type="text"
                name="q"
                placeholder="Orden o cliente"
                defaultValue={q}
                className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm"
              />
            </div>
            <div className="md:col-span-1 flex gap-2">
              <button
                type="submit"
                className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm flex-1"
              >
                Filtrar
              </button>
              <a
                href="/ventas"
                className="h-9 px-3 rounded-md border border-border text-sm flex items-center"
              >
                Limpiar
              </a>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ── KPI strip + monthly chart over the FULL filtered range ───────── */}
      <VentasSummary
        role={role}
        from={toISODate(from)}
        to={toISODate(to)}
        canal={canalFilter}
        estado={estadoFilter}
        q={q}
      />

      {/* ── Results table ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Órdenes</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <p className="text-xs text-destructive mb-2">{error.message}</p>
          )}
          {sales.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin órdenes para los filtros actuales.
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Fecha</Th>
                  <Th>Canal</Th>
                  <Th>Orden</Th>
                  <Th>Cliente</Th>
                  <Th>Ciudad</Th>
                  <Th>Estado</Th>
                  <Th className="text-right">Ítems</Th>
                  {showMoney && <Th className="text-right">Total</Th>}
                </Tr>
              </Thead>
              <Tbody>
                {sales.map((s) => {
                  const fecha = s.fecha as string;
                  const hora = (s.hora as string | null) ?? "";
                  const itemCount = itemCountBySale.get(s.sale_id as string) ?? 0;
                  return (
                    <Tr key={s.sale_id as string}>
                      <Td className="tabular-nums whitespace-nowrap">
                        {fecha}
                        {hora && (
                          <span className="text-muted-foreground ml-2 text-xs">
                            {hora.slice(0, 5)}
                          </span>
                        )}
                      </Td>
                      <Td>
                        <Badge variant="muted">
                          {CANAL_LABELS[s.canal as string] ??
                            (s.canal as string)}
                        </Badge>
                      </Td>
                      <Td className="font-mono text-xs">
                        {(s.external_order_id as string).slice(-10)}
                      </Td>
                      <Td className="max-w-[200px] truncate">
                        {(s.customer_name as string | null) ?? "—"}
                      </Td>
                      <Td className="text-muted-foreground">
                        {(s.customer_city as string | null) ?? "—"}
                      </Td>
                      <Td>
                        <Badge
                          variant={
                            ESTADO_VARIANT[s.estado as string] ?? "muted"
                          }
                        >
                          {s.estado as string}
                        </Badge>
                      </Td>
                      <Td className="text-right tabular-nums">
                        {NUM.format(itemCount)}
                      </Td>
                      {showMoney && (
                        <Td className="text-right tabular-nums">
                          {COP.format(Number(s.total ?? 0))}
                        </Td>
                      )}
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex justify-between items-center">
          <p className="text-xs text-muted-foreground">
            Mostrando {offset + 1}–{offset + sales.length} de{" "}
            {NUM.format(totalCount ?? sales.length)}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <a
                href={buildHref({ page: String(page - 1) })}
                className="h-9 px-3 rounded-md border border-border text-sm flex items-center"
              >
                ← Anterior
              </a>
            )}
            {page < totalPages && (
              <a
                href={buildHref({ page: String(page + 1) })}
                className="h-9 px-3 rounded-md border border-border text-sm flex items-center"
              >
                Siguiente →
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
