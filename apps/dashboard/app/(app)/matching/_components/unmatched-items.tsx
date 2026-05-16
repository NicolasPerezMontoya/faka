// Server Component — "Items sin mapeo" section for /matching.
// Reads v_unmatched_items_grouped (sale_items with master_sku NULL,
// aggregated by canal + external_product_id and sorted by revenue impact).

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

function mlListingUrl(canal: string, ext: string): string | null {
  if (canal !== "mercadolibre") return null;
  // ML publication ids look like MCO12345. The public URL pattern is
  // articulo.mercadolibre.com.co/<MCO12345>.
  const m = ext.match(/^MCO\d+$/);
  if (!m) return null;
  return `https://articulo.mercadolibre.com.co/${ext}`;
}

export async function UnmatchedItemsTable({ role }: { role: UserRole | null }) {
  const showMoney = role !== "analista";
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data, error } = await sb
    .from("v_unmatched_items_grouped")
    .select(
      "canal, external_product_id, product_name, external_sku, item_count, order_count, revenue, first_seen, last_seen",
    )
    .order("revenue", { ascending: false })
    .limit(50);
  const rows = data ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Items pendientes de mapear</CardTitle>
          <Badge variant="warn">{NUM.format(rows.length)} listings</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Publicaciones del canal que tienen ventas pero aún no están
          vinculadas a un master_product. Ordenadas por impacto en ingresos.
        </p>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-xs text-destructive mb-2">{error.message}</p>
        )}
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todo emparejado.
          </p>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Canal</Th>
                <Th>Producto</Th>
                <Th>SKU</Th>
                <Th className="text-right">Órdenes</Th>
                <Th className="text-right">Unidades</Th>
                {showMoney && <Th className="text-right">Ingresos</Th>}
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((r: Record<string, unknown>) => {
                const canal = (r.canal as string) ?? "";
                const ext = (r.external_product_id as string) ?? "";
                const url = mlListingUrl(canal, ext);
                return (
                  <Tr key={`${canal}:${ext}`}>
                    <Td>
                      <Badge variant="muted">
                        {CHANNEL_LABEL[canal] ?? canal}
                      </Badge>
                    </Td>
                    <Td>
                      <div className="font-medium max-w-[420px] truncate">
                        {(r.product_name as string) ?? "(sin título)"}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                          >
                            {ext} ↗
                          </a>
                        ) : (
                          ext
                        )}
                      </div>
                    </Td>
                    <Td className="font-mono text-xs">
                      {(r.external_sku as string) ?? "—"}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {NUM.format(Number(r.order_count ?? 0))}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {NUM.format(Number(r.item_count ?? 0))}
                    </Td>
                    {showMoney && (
                      <Td className="text-right tabular-nums">
                        {COP.format(Number(r.revenue ?? 0))}
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
  );
}
