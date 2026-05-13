// Historial — design from docs/sketches/csv-upload-wizard.html:393-460

import Link from 'next/link';
import { Badge, Card, CardContent, CardHeader, CardTitle, DataTable } from '@faka/ui';
import { createClient } from '@/lib/supabase/server';
import { listUploads, type UploadHistoryRow } from './_actions/list';
import { HistoryRowActions } from './_components/history-row-actions';

interface SearchParams {
  highlight?: string;
}

const STATUS_VARIANT: Record<string, 'info' | 'ok' | 'warn' | 'err' | 'muted'> = {
  uploaded: 'info',
  validating: 'warn',
  processed: 'ok',
  failed: 'err',
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (diffMin < 1) return 'hace un momento';
  if (diffMin < 60) return `hace ${diffMin} min`;
  if (diffMin < 60 * 24) return `hace ${Math.floor(diffMin / 60)} h`;
  return date.toLocaleDateString('es-CO', { month: 'short', day: 'numeric' });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export default async function HistorialPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createClient();
  const uploads = await listUploads(50);
  const { data: profiles } = await supabase
    .from('csv_mapping_profiles')
    .select('id, nombre, canal, tipo, version, is_active');

  const profilesShaped = (profiles ?? []).map((p) => ({
    id: p.id as string,
    nombre: p.nombre as string,
    canal: p.canal as string,
    tipo: p.tipo as string,
    version: p.version as number,
    is_active: p.is_active as boolean,
  }));

  const highlight = searchParams.highlight ?? null;

  return (
    <div>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Historial de cargas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Últimas 50 cargas CSV. Reprocesar usa los bytes inmutables guardados en Storage (ADR-001).
          </p>
        </div>
        <Link href="/operacion/upload" className="text-sm font-medium hover:underline">
          + Nueva carga
        </Link>
      </header>

      {uploads.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Sin cargas todavía</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Al subir tu primer CSV aparecerá aquí con su estado y opción de reprocesado.
            </p>
            <Link href="/operacion/upload" className="text-sm font-medium hover:underline mt-3 inline-block">
              Subir CSV →
            </Link>
          </CardContent>
        </Card>
      ) : (
        <DataTable<UploadHistoryRow>
          rows={uploads}
          keyFn={(row) => row.upload_id}
          columns={[
            {
              header: 'Cuándo',
              cell: (row) => (
                <span className={highlight === row.upload_id ? 'font-medium' : 'text-muted-foreground'}>
                  {formatTime(row.uploaded_at)}
                </span>
              ),
            },
            { header: 'Canal', cell: (row) => row.canal_declarado },
            { header: 'Tipo', cell: (row) => row.tipo },
            {
              header: 'Archivo',
              cell: (row) => (
                <code className="text-xs">{row.filename} · {formatBytes(row.bytes)}</code>
              ),
            },
            {
              header: 'Filas',
              cell: (row) => row.row_count.toLocaleString('es-CO'),
              className: 'text-right',
              thClassName: 'text-right',
            },
            {
              header: 'Perfil',
              cell: (row) =>
                row.mapping_profile_nombre ? (
                  <span className="text-xs">
                    {row.mapping_profile_nombre}{' '}
                    <Badge variant="info">v{row.mapping_profile_version}</Badge>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                ),
            },
            {
              header: 'Estado',
              cell: (row) => (
                <Badge variant={STATUS_VARIANT[row.status] ?? 'muted'}>{row.status}</Badge>
              ),
            },
            {
              header: '',
              cell: (row) => (
                <HistoryRowActions
                  uploadId={row.upload_id}
                  canal={row.canal_declarado}
                  tipo={row.tipo}
                  currentProfileId={row.mapping_profile_id}
                  currentProfileVersion={row.mapping_profile_version}
                  availableProfiles={profilesShaped.filter(
                    (p) => p.canal === row.canal_declarado && p.tipo === row.tipo,
                  )}
                  status={row.status}
                />
              ),
              thClassName: 'text-right',
              className: 'text-right',
            },
          ]}
        />
      )}
    </div>
  );
}
