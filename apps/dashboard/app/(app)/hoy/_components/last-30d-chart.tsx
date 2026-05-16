// Server Component — last-30-days trend bar chart for /hoy.
// Reads v_ventas_30d_daily and fills gaps so weekends/idle days show as
// zero-height bars instead of disappearing. Pure-CSS bars — same approach
// as per-channel-chart.tsx (no chart-lib dep).

import { Card, CardContent, CardHeader, CardTitle, Badge } from "@faka/ui";
import type { UserRole } from "@faka/schema";
import { createClient } from "@/lib/supabase/server";

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const NUM = new Intl.NumberFormat("es-CO");
const SHORT_DATE = new Intl.DateTimeFormat("es-CO", {
  day: "2-digit",
  month: "short",
  timeZone: "America/Bogota",
});

interface DayBucket {
  fecha: string;
  ordenes: number;
  ingresos: number;
  unidades: number;
}

export async function LastThirtyDaysChart({
  role,
}: {
  role: UserRole | null;
}) {
  const showMoney = role !== "analista";
  const supabase = createClient();
  // Cast to `any` — v_ventas_30d_daily was just added; database.ts hasn't
  // been regenerated yet. Drop once codegen catches up.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data, error } = await sb
    .from("v_ventas_30d_daily")
    .select("fecha, ordenes, ingresos, unidades");

  // Sum across canales (the view groups by fecha+canal — we want totals).
  const byDay = new Map<string, DayBucket>();
  for (const r of data ?? []) {
    const k = r.fecha as string;
    const cur = byDay.get(k) ?? {
      fecha: k,
      ordenes: 0,
      ingresos: 0,
      unidades: 0,
    };
    cur.ordenes += Number(r.ordenes ?? 0);
    cur.ingresos += Number(r.ingresos ?? 0);
    cur.unidades += Number(r.unidades ?? 0);
    byDay.set(k, cur);
  }

  // Fill 30-day window so the chart axis is stable.
  const days: DayBucket[] = [];
  const today = new Date();
  const offsetMin = today.getTimezoneOffset();
  // Bogotá offset adjustment: build dates in UTC then format
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    days.push(
      byDay.get(iso) ?? {
        fecha: iso,
        ordenes: 0,
        ingresos: 0,
        unidades: 0,
      },
    );
  }

  const maxIngresos = days.reduce((m, d) => Math.max(m, d.ingresos), 0);
  const totalIngresos = days.reduce((acc, d) => acc + d.ingresos, 0);
  const totalOrdenes = days.reduce((acc, d) => acc + d.ordenes, 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Últimos 30 días · tendencia</CardTitle>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {showMoney && (
              <span>
                Ingresos:{" "}
                <strong className="text-foreground">
                  {COP.format(totalIngresos)}
                </strong>
              </span>
            )}
            <span>
              Órdenes:{" "}
              <strong className="text-foreground">
                {NUM.format(totalOrdenes)}
              </strong>
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-xs text-destructive mb-2">{error.message}</p>
        )}
        {totalOrdenes === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin ventas en los últimos 30 días.
          </p>
        ) : (
          <div className="flex items-end gap-1 h-40 mt-2">
            {days.map((d) => {
              const heightPct =
                maxIngresos > 0 ? (d.ingresos / maxIngresos) * 100 : 0;
              const minPx = d.ordenes > 0 ? 2 : 0;
              const isToday =
                d.fecha === new Date().toISOString().slice(0, 10);
              return (
                <div
                  key={d.fecha}
                  className="flex-1 flex flex-col items-center justify-end group relative"
                  title={`${d.fecha} · ${NUM.format(d.ordenes)} órd · ${showMoney ? COP.format(d.ingresos) : "—"}`}
                >
                  <div
                    className={[
                      "w-full rounded-t transition-colors",
                      isToday ? "bg-primary" : "bg-primary/40",
                      "hover:bg-primary/70",
                    ].join(" ")}
                    style={{
                      height: `max(${heightPct}%, ${minPx}px)`,
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-2 flex justify-between text-[10px] text-muted-foreground tabular-nums">
          <span>{SHORT_DATE.format(new Date(days[0]!.fecha))}</span>
          <span>{SHORT_DATE.format(new Date(days[14]!.fecha))}</span>
          <span>{SHORT_DATE.format(new Date(days[29]!.fecha))}</span>
        </div>
      </CardContent>
    </Card>
  );
}
