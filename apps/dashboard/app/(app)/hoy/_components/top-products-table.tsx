// Server Component — top 10 products today.
// Reads v_hoy_top_products; only shows matched items (master_sku NOT NULL).
// Unmatched items flow to /matching, not here.

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
} from "@faka/ui";
import type { UserRole } from "@faka/schema";
import { createClient } from "@/lib/supabase/server";

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const NUM = new Intl.NumberFormat("es-CO");

export async function TopProductsTable({ role }: { role: UserRole | null }) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("v_hoy_top_products")
    .select("*");

  const showMoney = role !== "analista";
  const rows = data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top 10 productos · hoy</CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-xs text-destructive mb-2">{error.message}</p>
        )}
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aún no hay productos vendidos hoy (o las ventas no están emparejadas
            con el catálogo maestro — revisa la cola de validación).
          </p>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Producto</Th>
                <Th className="text-right">Unidades</Th>
                <Th className="text-right">Órdenes</Th>
                {showMoney && <Th className="text-right">Ingresos</Th>}
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((r) => (
                <Tr key={r.master_sku as string}>
                  <Td>
                    <div className="font-medium">{r.nombre_canonico}</div>
                    {r.brand && (
                      <div className="text-xs text-muted-foreground">
                        {r.brand}
                      </div>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {NUM.format(Number(r.unidades ?? 0))}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {NUM.format(Number(r.ordenes ?? 0))}
                  </Td>
                  {showMoney && (
                    <Td className="text-right tabular-nums">
                      {COP.format(Number(r.ingresos ?? 0))}
                    </Td>
                  )}
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
