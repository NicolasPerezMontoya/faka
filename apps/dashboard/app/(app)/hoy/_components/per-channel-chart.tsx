// Server Component — per-channel breakdown bar chart for /hoy.
// Role-aware: analista reads v_hoy_per_channel_analista (ingresos NULL).
// Bars are pure CSS — no chart library dependency to keep build slim.

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

const CHANNEL_LABEL: Record<string, string> = {
  wordpress: "WordPress",
  mercadolibre: "Mercado Libre",
  dropi: "Dropi",
  pos: "POS",
  whatsapp: "WhatsApp",
  falabella: "Falabella",
  "csv-upload": "CSV manual",
};

export async function PerChannelChart({ role }: { role: UserRole | null }) {
  const supabase = createClient();
  const view =
    role === "analista" ? "v_hoy_per_channel_analista" : "v_hoy_per_channel";

  const { data, error } = await supabase.from(view).select("*");

  const rows = data ?? [];
  const maxIngresos =
    role !== "analista"
      ? Math.max(...rows.map((r) => Number(r.ingresos ?? 0)), 1)
      : 1;
  const maxOrdenes = Math.max(...rows.map((r) => Number(r.ordenes ?? 0)), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Por canal · hoy</CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-xs text-destructive mb-2">{error.message}</p>
        )}
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aún no hay ventas del día.
          </p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => {
              const ingresos = Number(r.ingresos ?? 0);
              const ordenes = Number(r.ordenes ?? 0);
              const pct =
                role === "analista"
                  ? (ordenes / maxOrdenes) * 100
                  : (ingresos / maxIngresos) * 100;
              return (
                <li key={r.canal} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {CHANNEL_LABEL[r.canal as string] ?? r.canal}
                      </span>
                      <Badge variant="muted">{NUM.format(ordenes)} órd</Badge>
                    </div>
                    <span className="tabular-nums text-muted-foreground">
                      {role === "analista" || !ingresos
                        ? role === "analista"
                          ? "—"
                          : COP.format(0)
                        : COP.format(ingresos)}
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${Math.max(pct, 4)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
