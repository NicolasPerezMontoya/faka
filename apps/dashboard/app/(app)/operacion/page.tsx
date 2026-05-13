// Operación landing — list of operational tools available in F1.

import Link from 'next/link';
import { headers } from 'next/headers';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Badge } from '@faka/ui';
import type { UserRole } from '@faka/schema';

export default function OperacionPage() {
  const role = headers().get('x-user-role') as UserRole | null;

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Operación</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Carga manual, gestión de mapeos, salud de conectores y cola de validación.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link href="/operacion/upload" className="block group">
          <Card className="h-full transition-shadow group-hover:shadow-md">
            <CardHeader>
              <CardTitle>Subir CSV</CardTitle>
              <CardDescription>
                Wizard de 3 pasos para cargar productos o pedidos desde un archivo. El payload crudo se preserva inmutable.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Badge variant="ok">Disponible</Badge>
            </CardContent>
          </Card>
        </Link>

        <Link href="/operacion/historial" className="block group">
          <Card className="h-full transition-shadow group-hover:shadow-md">
            <CardHeader>
              <CardTitle>Historial de cargas</CardTitle>
              <CardDescription>
                Últimas cargas con estado, conteo de filas y opción de reprocesar con una versión más reciente del perfil.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Badge variant="ok">Disponible</Badge>
            </CardContent>
          </Card>
        </Link>

        <Card className="h-full opacity-60">
          <CardHeader>
            <CardTitle>Health de conectores</CardTitle>
            <CardDescription>
              Estado en vivo por canal: última sincronización, errores recientes, reintentos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="muted">Fase 3</Badge>
          </CardContent>
        </Card>

        <Card className="h-full opacity-60">
          <CardHeader>
            <CardTitle>Cola de validación</CardTitle>
            <CardDescription>
              Productos pendientes de match humano de la cascada IA + barcode.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="muted">Fase 2</Badge>
          </CardContent>
        </Card>
      </div>

      <p className="mt-8 text-xs text-muted-foreground">Sesión activa como rol: {role ?? 'desconocido'}.</p>
    </div>
  );
}
