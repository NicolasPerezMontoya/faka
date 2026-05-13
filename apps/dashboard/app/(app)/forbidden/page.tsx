import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button } from '@faka/ui';

export default function ForbiddenPage() {
  return (
    <div className="min-h-[60vh] grid place-items-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Acceso denegado</CardTitle>
          <CardDescription>Tu rol no tiene permisos para ver esta página.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Si crees que es un error, contacta a un Super Admin para revisar tus permisos.
          </p>
          <Button asChild={false} variant="outline">
            <Link href="/">Volver al inicio</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
