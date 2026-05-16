// /hoy — F2 dashboard landing.
// Aggregates today's sales across all channels in one view.
// 4 sections: totals, per-channel chart, top 10 products, last-hour live feed.
// Role-aware: analista sees no money columns (reads v_hoy_per_channel_analista).

import { headers } from "next/headers";
import type { UserRole } from "@faka/schema";
import { TotalsCard } from "./_components/totals-card.js";
import { PerChannelChart } from "./_components/per-channel-chart.js";
import { TopProductsTable } from "./_components/top-products-table.js";
import { LiveFeedRows } from "./_components/live-feed-rows.js";
import { LastThirtyDaysChart } from "./_components/last-30d-chart.js";

export const dynamic = "force-dynamic";

export default function HoyPage() {
  const role = headers().get("x-user-role") as UserRole | null;

  const today = new Date().toLocaleDateString("es-CO", {
    timeZone: "America/Bogota",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Hoy</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {today} · zona horaria America/Bogota
        </p>
      </header>

      <TotalsCard role={role} />

      <LastThirtyDaysChart role={role} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PerChannelChart role={role} />
        <TopProductsTable role={role} />
      </div>

      <LiveFeedRows role={role} />
    </div>
  );
}
