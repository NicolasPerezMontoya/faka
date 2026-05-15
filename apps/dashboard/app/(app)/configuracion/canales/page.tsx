// /configuracion/canales — channel hub.
// Lists every integration faka supports with its current connect status and a
// CTA. Mercado Libre is the only live OAuth flow today; WordPress/Dropi/etc.
// are documented + future-flagged.

import Link from "next/link";
import { headers } from "next/headers";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Badge,
  Button,
} from "@faka/ui";
import { getMLConnectionStatus } from "@faka/connectors/mercadolibre";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { UserRole } from "@faka/schema";

export const dynamic = "force-dynamic";

interface ChannelTile {
  key: string;
  name: string;
  description: string;
  /** "connected" | "ready" | "not_configured" | "coming_soon" */
  status: "connected" | "ready" | "not_configured" | "coming_soon";
  ctaLabel: string;
  ctaHref: string | null;
  meta?: string;
}

function statusBadge(s: ChannelTile["status"]): React.ReactNode {
  switch (s) {
    case "connected":
      return <Badge variant="ok">Conectado</Badge>;
    case "ready":
      return <Badge variant="info">Listo para conectar</Badge>;
    case "not_configured":
      return <Badge variant="muted">Sin configurar</Badge>;
    case "coming_soon":
      return <Badge variant="muted">Próximamente</Badge>;
  }
}

export default async function CanalesPage() {
  const role = headers().get("x-user-role") as UserRole | null;

  // Mercado Libre — real status from oauth_tokens + env.
  const supabase = createServiceRoleClient();
  const mlStatus = await getMLConnectionStatus(supabase);

  const mlTile: ChannelTile = {
    key: "mercadolibre",
    name: "Mercado Libre",
    description:
      "OAuth + sync de órdenes y publicaciones · webhooks en tiempo real.",
    status: !mlStatus.configured
      ? "not_configured"
      : mlStatus.connected
        ? "connected"
        : "ready",
    ctaLabel: mlStatus.connected ? "Reconectar" : "Conectar",
    ctaHref: "/operacion/conectar-mercadolibre",
    meta: mlStatus.connected ? `user_id=${mlStatus.user_id ?? "?"}` : undefined,
  };

  const otherTiles: ChannelTile[] = [
    {
      key: "wordpress",
      name: "WordPress · WooCommerce",
      description:
        "Webhooks WC + pull horario. Requiere WORDPRESS_API_URL + secret.",
      status: "not_configured",
      ctaLabel: "Configurar credenciales",
      ctaHref: null,
    },
    {
      key: "dropi",
      name: "Dropi",
      description: "Proveedor de productos dropshipping.",
      status: "coming_soon",
      ctaLabel: "Disponible en próxima fase",
      ctaHref: null,
    },
    {
      key: "pos",
      name: "POS · WhatsApp · Falabella",
      description: "Canales programados para fases siguientes.",
      status: "coming_soon",
      ctaLabel: "Disponible en próxima fase",
      ctaHref: null,
    },
  ];

  const tiles: ChannelTile[] = [mlTile, ...otherTiles];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Canales</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Estado de conexión por canal. Cada conexión incluye OAuth, webhook
          en tiempo real y sync periódico de respaldo.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {tiles.map((t) => (
          <Card key={t.key}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{t.name}</CardTitle>
                  <CardDescription className="mt-1">
                    {t.description}
                  </CardDescription>
                </div>
                {statusBadge(t.status)}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {t.meta && (
                <p className="text-xs text-muted-foreground font-mono">{t.meta}</p>
              )}
              {t.ctaHref ? (
                <Link href={t.ctaHref}>
                  <Button variant={t.status === "connected" ? "outline" : "default"}>
                    {t.ctaLabel}
                  </Button>
                </Link>
              ) : (
                <Button variant="outline" disabled>
                  {t.ctaLabel}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
