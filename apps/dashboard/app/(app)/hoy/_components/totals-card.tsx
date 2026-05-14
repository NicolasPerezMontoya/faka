// Server Component — totals card for /hoy.
// Reads v_hoy_totals view (SECURITY INVOKER, role-gated via RLS).
// Analista variant: ingresos column displayed as "—" (ADR-002).

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

export async function TotalsCard({ role }: { role: UserRole | null }) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("v_hoy_totals")
    .select("*")
    .single();

  const ingresos = data?.ingresos_hoy ?? 0;
  const unidades = Number(data?.unidades_hoy ?? 0);
  const ordenes = Number(data?.ordenes_hoy ?? 0);
  const showMoney = role !== "analista";

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Ingresos hoy
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-semibold tabular-nums">
            {showMoney ? COP.format(Number(ingresos)) : "—"}
          </div>
          {error && (
            <p className="mt-1 text-xs text-destructive">
              {error.message}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Unidades vendidas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-semibold tabular-nums">
            {NUM.format(unidades)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Órdenes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-semibold tabular-nums">
            {NUM.format(ordenes)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
