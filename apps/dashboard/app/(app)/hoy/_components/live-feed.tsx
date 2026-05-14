"use client";

// Client Component — subscribes to Supabase Realtime postgres_changes
// on `sales` filtered to today (America/Bogota). Falls back to SSR
// initialRows if WS fails to connect.
//
// CC-11: reads NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
// only (the createClient helper enforces this).

import { useEffect, useState } from "react";
import type { UserRole } from "@faka/schema";
import { Badge, Table, Thead, Tbody, Tr, Th, Td } from "@faka/ui";
import { createClient } from "@/lib/supabase/browser";

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const TIME = new Intl.DateTimeFormat("es-CO", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Bogota",
});

const CHANNEL_LABEL: Record<string, string> = {
  wordpress: "WordPress",
  mercadolibre: "Mercado Libre",
  dropi: "Dropi",
  pos: "POS",
  whatsapp: "WhatsApp",
  falabella: "Falabella",
  "csv-upload": "CSV manual",
};

export interface LiveFeedRow {
  sale_id: string;
  canal: string;
  created_at: string;
  total: number;
  item_count: number;
}

export function LiveFeed({
  initialRows,
  role,
}: {
  initialRows: LiveFeedRow[];
  role: UserRole | null;
}) {
  const [rows, setRows] = useState<LiveFeedRow[]>(initialRows);
  const [connected, setConnected] = useState(false);
  const showMoney = role !== "analista";

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("hoy-sales-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sales" },
        (payload) => {
          const r = payload.new as {
            sale_id: string;
            canal: string;
            created_at: string;
            total: number | string;
          };
          setRows((prev) =>
            [
              {
                sale_id: r.sale_id,
                canal: r.canal,
                created_at: r.created_at,
                total: Number(r.total),
                item_count: 0,
              },
              ...prev,
            ].slice(0, 50),
          );
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setConnected(true);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (rows.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        Sin ventas en la última hora. Apenas entren nuevas órdenes aparecerán
        aquí en tiempo real.
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-end mb-2">
        {connected ? (
          <Badge variant="ok">En vivo</Badge>
        ) : (
          <Badge variant="muted">Sin actualización en tiempo real</Badge>
        )}
      </div>
      <Table>
        <Thead>
          <Tr>
            <Th>Hora</Th>
            <Th>Canal</Th>
            <Th>Orden</Th>
            <Th className="text-right">Ítems</Th>
            {showMoney && <Th className="text-right">Total</Th>}
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((r) => (
            <Tr key={r.sale_id}>
              <Td className="tabular-nums">
                {TIME.format(new Date(r.created_at))}
              </Td>
              <Td>
                <Badge variant="muted">
                  {CHANNEL_LABEL[r.canal] ?? r.canal}
                </Badge>
              </Td>
              <Td className="font-mono text-xs">
                {r.sale_id.slice(0, 8)}
              </Td>
              <Td className="text-right tabular-nums">{r.item_count}</Td>
              {showMoney && (
                <Td className="text-right tabular-nums">
                  {COP.format(r.total)}
                </Td>
              )}
            </Tr>
          ))}
        </Tbody>
      </Table>
    </div>
  );
}
