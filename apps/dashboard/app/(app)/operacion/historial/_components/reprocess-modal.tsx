// Reprocess modal — design from docs/sketches/csv-upload-wizard.html

'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardContent, CardHeader, CardTitle, Select, Badge } from '@faka/ui';
import { reprocessUploadAction } from '../_actions/reprocess';

export interface ReprocessModalProps {
  open: boolean;
  onClose: () => void;
  uploadId: string;
  canal: string;
  tipo: string;
  currentProfileId: string | null;
  currentProfileVersion: number | null;
  availableProfiles: Array<{ id: string; nombre: string; version: number; is_active: boolean }>;
}

export function ReprocessModal({
  open,
  onClose,
  uploadId,
  canal,
  tipo,
  currentProfileId,
  currentProfileVersion,
  availableProfiles,
}: ReprocessModalProps) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<string>(currentProfileId ?? '');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!open) return null;

  async function onConfirm() {
    if (!selected || selected === currentProfileId) {
      setError('Selecciona una versión distinta a la actual.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await reprocessUploadAction({ uploadId, newProfileId: selected });
    if (!result.ok) {
      setError(result.error ?? 'reprocess_failed');
      setSubmitting(false);
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Reprocesar carga</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Canal: <strong>{canal}</strong> · Tipo: <strong>{tipo}</strong>
            {currentProfileVersion !== null && (
              <>
                {' · Versión actual: '}
                <Badge variant="info">v{currentProfileVersion}</Badge>
              </>
            )}
          </p>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Los bytes del archivo en Storage se mantienen intactos (ADR-001). Las filas previas se
            marcan como reemplazadas; las nuevas usan el perfil seleccionado.
          </p>
          <label className="block text-sm font-medium mb-1">Nueva versión del perfil</label>
          <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">— elige una versión —</option>
            {availableProfiles.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.is_active}>
                {p.nombre} (v{p.version}) {p.id === currentProfileId ? '· actual' : ''}
              </option>
            ))}
          </Select>
          {error && <p className="text-xs text-destructive mt-2">{error}</p>}
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={onConfirm} disabled={submitting || !selected}>
              {submitting ? 'Reprocesando…' : 'Confirmar reprocesado'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
