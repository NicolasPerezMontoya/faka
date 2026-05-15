// /configuracion — settings hub landing.
// Currently a single section ("Canales"); future plans add Usuarios + Webhooks.

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@faka/ui";

export const dynamic = "force-dynamic";

export default function ConfiguracionPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Configuración</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Conexiones, integraciones y ajustes del workspace.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link href="/configuracion/canales" className="block">
          <Card className="hover:bg-muted/40 transition-colors">
            <CardHeader>
              <CardTitle>Canales</CardTitle>
              <CardDescription>
                Conectar Mercado Libre, WordPress, Dropi y más. Estado y rotación
                de credenciales por canal.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">→ Ir a Canales</p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
