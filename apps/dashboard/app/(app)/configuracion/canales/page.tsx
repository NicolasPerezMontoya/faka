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
import { getPOSConnectionStatus } from "@faka/connectors/pos";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { UserRole } from "@faka/schema";

export const dynamic = "force-dynamic";

interface ChannelTile {
  key: string;
  name: string;
  description: string;
  /** "connected" | "ready" | "not_configured" | "coming_soon" | "blocked" */
  status: "connected" | "ready" | "not_configured" | "coming_soon" | "blocked";
  ctaLabel: string;
  ctaHref: string | null;
  meta?: string;
  /** Optional list of sub-rows rendered below the main meta. */
  subRows?: Array<{ label: string; value: string; tone?: "ok" | "warn" | "err" }>;
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
    case "blocked":
      return <Badge variant="warn">Esperando WAF</Badge>;
  }
}

export default async function CanalesPage() {
  const role = headers().get("x-user-role") as UserRole | null;

  // Mercado Libre — real status from oauth_tokens + env.
  const supabase = createServiceRoleClient();
  const [mlStatus, posStatus] = await Promise.all([
    getMLConnectionStatus(supabase),
    getPOSConnectionStatus(supabase),
  ]);

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

  // POS — env-driven status + per-location last run.
  const allLocsRanOnce = posStatus.locations.every(
    (l) => l.last_started_at !== null,
  );
  const allLocsHealthy =
    posStatus.locations.length > 0 &&
    posStatus.locations.every(
      (l) => l.last_status === "succeeded" || l.last_status === "partial",
    );
  let posTileStatus: ChannelTile["status"];
  if (!posStatus.configured) {
    posTileStatus = "not_configured";
  } else if (!allLocsRanOnce) {
    posTileStatus = "blocked"; // Configured but no successful run yet → WAF likely.
  } else if (allLocsHealthy) {
    posTileStatus = "connected";
  } else {
    posTileStatus = "ready";
  }

  const posTile: ChannelTile = {
    key: "pos",
    name: "Punto de venta (PHP POS)",
    description: posStatus.configured
      ? "PHP Point Of Sale REST v1 · 2 tiendas físicas con pull horario."
      : "PHP Point Of Sale REST v1. Configura POS_API_URL, POS_API_KEY y POS_LOCATION_MAP en Railway para activar.",
    status: posTileStatus,
    ctaLabel: posStatus.configured ? "Ver últimas ventas" : "Pendiente de configuración",
    ctaHref: posStatus.configured ? "/ventas?canal=pos1" : null,
    meta: posStatus.configured
      ? `${posStatus.locations.length} tienda(s) mapeada(s)`
      : posStatus.missing.length > 0
        ? `Faltan envs: ${posStatus.missing.join(", ")}`
        : undefined,
    subRows: posStatus.locations.map((l) => ({
      label: `${l.canal} (location_id=${l.location_id})`,
      value: l.last_started_at
        ? `${l.last_status} · ${l.last_records_processed} procesadas · ${l.last_started_at.slice(0, 19).replace("T", " ")}`
        : "sin corridas aún",
      tone:
        l.last_status === "succeeded"
          ? "ok"
          : l.last_status === "partial"
            ? "warn"
            : l.last_status === "failed"
              ? "err"
              : undefined,
    })),
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
      key: "whatsapp",
      name: "WhatsApp · Falabella",
      description: "Canales programados para fases siguientes.",
      status: "coming_soon",
      ctaLabel: "Disponible en próxima fase",
      ctaHref: null,
    },
  ];

  const tiles: ChannelTile[] = [mlTile, posTile, ...otherTiles];

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
              {t.subRows && t.subRows.length > 0 && (
                <div className="border-t border-border pt-3 space-y-1">
                  {t.subRows.map((sr, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between text-xs gap-2"
                    >
                      <span className="text-muted-foreground font-mono">
                        {sr.label}
                      </span>
                      <span
                        className={[
                          "tabular-nums",
                          sr.tone === "ok"
                            ? "text-emerald-700"
                            : sr.tone === "warn"
                              ? "text-amber-700"
                              : sr.tone === "err"
                                ? "text-destructive"
                                : "text-foreground",
                        ].join(" ")}
                      >
                        {sr.value}
                      </span>
                    </div>
                  ))}
                </div>
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
