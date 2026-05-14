// Server Component — initial SSR data + role.
// Renders the LiveFeed client wrapper with rows already populated so
// the page is meaningful even if Realtime never connects (firewall etc.).

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@faka/ui";
import type { UserRole } from "@faka/schema";
import { createClient } from "@/lib/supabase/server";
import { LiveFeed } from "./live-feed.js";

export async function LiveFeedRows({ role }: { role: UserRole | null }) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("v_hoy_last_hour")
    .select("*");

  const initialRows = (data ?? []).map((r) => ({
    sale_id: r.sale_id as string,
    canal: (r.canal as string) ?? "",
    created_at: (r.created_at as string) ?? new Date().toISOString(),
    total: Number(r.total ?? 0),
    item_count: Number(r.item_count ?? 0),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Última hora · tiempo real</CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-xs text-destructive mb-2">{error.message}</p>
        )}
        <LiveFeed initialRows={initialRows} role={role} />
      </CardContent>
    </Card>
  );
}
