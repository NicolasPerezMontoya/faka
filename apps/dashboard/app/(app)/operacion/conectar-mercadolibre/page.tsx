/**
 * Conectar Mercado Libre — F2.1 Plan 2.1.3.4.
 *
 * Single-step OAuth bootstrap UX. Read-only status pill + a server-action
 * button that mints a `state` nonce, persists it in `oauth_state`, and
 * redirects the user to ML's authorize page. The actual code-exchange + token
 * persistence happens on the callback route (`/api/oauth/callback/route.ts`).
 *
 * ── Role gate ───────────────────────────────────────────────────────────────
 *
 * Route requires `super_admin` or `admin` (role-matrix entry added in this
 * plan). The middleware enforces the boundary; this page additionally renders
 * a defensive forbidden state for anyone who slipped past the middleware.
 *
 * ── State surface ───────────────────────────────────────────────────────────
 *
 * Three states the page surfaces visually:
 *   - `not_configured` — ML envs missing on the host (Vercel for v1).
 *   - `ready_to_connect` — envs present, but `oauth_tokens` row absent.
 *   - `connected` — at least one row in `oauth_tokens` for canal='mercadolibre'.
 *
 * Each is read from the orchestrator's `getMLConnectionStatus` helper (which
 * the connectors package exports). The dashboard uses the service-role
 * Supabase client to read `oauth_tokens` — the row's `access_token` is NEVER
 * surfaced (CC-11 invariant); only the seller's `user_id` is shown.
 *
 * ── Query-string flags ──────────────────────────────────────────────────────
 *
 *   ?status=success — landing after the callback's UPSERT.
 *   ?status=error&reason=... — landing after a failed exchange.
 */

import { headers } from "next/headers";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  Button,
} from "@faka/ui";
import { getMLConnectionStatus } from "@faka/connectors/mercadolibre";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { UserRole } from "@faka/schema";
import { startMlOAuthAction } from "./_actions/start-oauth";

interface SearchParams {
  status?: string;
  reason?: string;
}

export default async function ConectarMercadoLibrePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const role = headers().get("x-user-role") as UserRole | null;

  // Defensive — middleware should have blocked already. The matrix entry is
  // super_admin + admin only.
  if (role !== "super_admin" && role !== "admin") {
    return (
      <div>
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">
            Conectar Mercado Libre
          </h1>
        </header>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">
              No tienes permisos para gestionar conexiones de canal.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Use the service-role client — `oauth_tokens` has no authenticated SELECT
  // policy by design. The helper returns a structured envelope; it never
  // returns the access_token or refresh_token (CC-11).
  const supabase = createServiceRoleClient();
  const status = await getMLConnectionStatus(supabase);

  const flagStatus = searchParams.status ?? null;
  const flagReason = searchParams.reason ?? null;

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Conectar Mercado Libre
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Autoriza una vez al dueño de la tienda. El orchestrator queda
          conectado a ML Colombia (siteId MCO) y los pedidos empiezan a llegar
          al dashboard automáticamente.
        </p>
      </header>

      {flagStatus === "success" && (
        <div className="mb-4">
          <Card className="border-green-500/40">
            <CardContent className="p-4 text-sm">
              <strong className="text-green-700">Conectado.</strong> El sync de
              pedidos arrancará en el próximo tick (cada 15 min).
            </CardContent>
          </Card>
        </div>
      )}
      {flagStatus === "error" && (
        <div className="mb-4">
          <Card className="border-red-500/40">
            <CardContent className="p-4 text-sm">
              <strong className="text-red-700">No se pudo conectar.</strong>{" "}
              Razón: <code>{flagReason ?? "unknown"}</code>. Verifica las
              variables ML_* en Vercel y vuelve a intentarlo.
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Estado de conexión</CardTitle>
          <CardDescription>
            {status.configured
              ? status.connected
                ? `Conectado como user_id=${status.user_id ?? "?"}.`
                : "Variables OAuth configuradas. Listo para conectar."
              : "Variables OAuth no configuradas. Configura ML_CLIENT_ID, ML_CLIENT_SECRET, ML_REDIRECT_URI y ML_WEBHOOK_SECRET en Vercel."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!status.configured && (
            <Badge variant="muted">No configurado</Badge>
          )}
          {status.configured && !status.connected && (
            <>
              <Badge variant="ok">Listo para conectar</Badge>
              <form action={startMlOAuthAction}>
                <Button type="submit" variant="default">
                  Conectar con Mercado Libre
                </Button>
              </form>
              <p className="text-xs text-muted-foreground">
                Al hacer clic serás redirigido a auth.mercadolibre.com.co para
                autorizar el acceso. Solo el dueño de la cuenta ML debe
                completar este flujo.
              </p>
            </>
          )}
          {status.configured && status.connected && (
            <>
              <Badge variant="ok">Conectado</Badge>
              <form action={startMlOAuthAction}>
                <Button type="submit" variant="outline">
                  Reconectar
                </Button>
              </form>
              <p className="text-xs text-muted-foreground">
                Reconectar rota los tokens y mantiene el mismo user_id si el
                operador autoriza la misma cuenta ML.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
