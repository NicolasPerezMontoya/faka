// Server Component — KPIs + monthly-revenue chart for the filtered range.
// Reads sales/sale_items directly (no view) because the date range is dynamic.

import { Card, CardContent, CardHeader, CardTitle } from "@faka/ui";
import type { UserRole } from "@faka/schema";
import { createClient } from "@/lib/supabase/server";

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const NUM = new Intl.NumberFormat("es-CO");
const MONTH = new Intl.DateTimeFormat("es-CO", {
  month: "short",
  year: "2-digit",
  timeZone: "America/Bogota",
});

interface Props {
  role: UserRole | null;
  from: string;
  to: string;
  canal: string;
  estado: string;
  q: string;
}

export async function VentasSummary({
  role,
  from,
  to,
  canal,
  estado,
  q,
}: Props) {
  const showMoney = role !== "analista";
  const supabase = createClient();

  // Pull all sales in the filtered range (no pagination — we need totals).
  // The query is bounded by date range so this is cheap even at year scale.
  let query = supabase
    .from("sales")
    .select("fecha, total, sale_id, canal, estado")
    .gte("fecha", from)
    .lte("fecha", to);
  if (canal) query = query.eq("canal", canal as never);
  if (estado) query = query.eq("estado", estado as never);
  if (q) query = query.or(`external_order_id.ilike.%${q}%,customer_name.ilike.%${q}%`);
  // PostgREST default cap is 1000; bump to 50k for the summary aggregate.
  const { data: sales } = await query.limit(50000);
  const rows = sales ?? [];

  const totalOrdenes = rows.length;
  const totalIngresos = rows.reduce((acc, r) => acc + Number(r.total ?? 0), 0);
  const avgTicket = totalOrdenes > 0 ? totalIngresos / totalOrdenes : 0;

  // Bucket by month
  const byMonth = new Map<string, { ordenes: number; ingresos: number }>();
  for (const r of rows) {
    const ym = (r.fecha as string).slice(0, 7); // YYYY-MM
    const cur = byMonth.get(ym) ?? { ordenes: 0, ingresos: 0 };
    cur.ordenes += 1;
    cur.ingresos += Number(r.total ?? 0);
    byMonth.set(ym, cur);
  }
  const months = [...byMonth.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const maxIngresos = months.reduce(
    (m, [, v]) => Math.max(m, v.ingresos),
    0,
  );

  return (
    <div className="space-y-4">
      {/* KPI strip — across the FULL filtered range, not pagination slice */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Órdenes en el rango
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">
              {NUM.format(totalOrdenes)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {from} → {to}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Ingresos totales
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">
              {showMoney ? COP.format(totalIngresos) : "—"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              suma de la columna Total
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Ticket promedio
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">
              {showMoney ? COP.format(avgTicket) : "—"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              ingresos ÷ órdenes
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Meses con ventas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">
              {NUM.format(months.length)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {totalOrdenes > 50000
                ? "muestreado a 50k"
                : "sin muestreo"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Monthly bars */}
      {months.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Ingresos por mes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-32">
              {months.map(([ym, v]) => {
                const heightPct =
                  maxIngresos > 0 ? (v.ingresos / maxIngresos) * 100 : 0;
                return (
                  <div
                    key={ym}
                    className="flex-1 flex flex-col items-center group"
                    title={`${ym} · ${NUM.format(v.ordenes)} órd · ${showMoney ? COP.format(v.ingresos) : "—"}`}
                  >
                    <div className="text-[10px] text-muted-foreground tabular-nums opacity-0 group-hover:opacity-100 transition-opacity">
                      {showMoney
                        ? COP.format(v.ingresos).replace("$", "$")
                        : ""}
                    </div>
                    <div className="w-full flex flex-col items-stretch justify-end h-full">
                      <div
                        className="w-full bg-primary/60 hover:bg-primary rounded-t"
                        style={{
                          height: `max(${heightPct}%, 2px)`,
                        }}
                      />
                    </div>
                    <div className="text-[10px] text-muted-foreground tabular-nums mt-1">
                      {MONTH.format(new Date(ym + "-01T00:00:00"))}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
