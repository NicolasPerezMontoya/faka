// Step 3 (Validar y confirmar) — design from docs/sketches/csv-upload-wizard.html:282-374

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, Badge } from "@faka/ui";
import { dryRunAction, type DryRunResult } from "../_actions/dry-run";
import { commitUploadAction } from "../_actions/commit-upload";

export interface StepValidateProps {
  uploadId: string | null;
  profileId: string | null;
}

export function StepValidate({ uploadId, profileId }: StepValidateProps) {
  const router = useRouter();
  const [dry, setDry] = React.useState<DryRunResult | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [committing, setCommitting] = React.useState(false);
  const [commitError, setCommitError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!uploadId || !profileId) {
      setLoading(false);
      return;
    }
    (async () => {
      const result = await dryRunAction({ uploadId, profileId });
      setDry(result);
      setLoading(false);
    })();
  }, [uploadId, profileId]);

  async function onConfirm() {
    if (!uploadId || !profileId) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const result = await commitUploadAction({ uploadId, profileId });
      if (!result.ok) {
        setCommitError(result.error ?? "commit_failed");
        setCommitting(false);
        return;
      }
      router.push(`/operacion/historial?highlight=${uploadId}`);
    } catch (err) {
      setCommitError((err as Error).message);
      setCommitting(false);
    }
  }

  if (!uploadId || !profileId) {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-1">3 · Validar y confirmar</h2>
        <p className="text-sm text-destructive">
          No se encontró el upload. Regresa al paso 2 para subir el archivo
          nuevamente.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-1">3 · Validando filas…</h2>
        <p className="text-sm text-muted-foreground">
          Aplicando el mapping al CSV en modo dry-run.
        </p>
      </div>
    );
  }

  if (!dry?.ok) {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-1">3 · Validación falló</h2>
        <p className="text-sm text-destructive">
          {dry?.error ?? "unknown_error"}
        </p>
        <Button variant="ghost" className="mt-4" onClick={() => router.back()}>
          ← Volver
        </Button>
      </div>
    );
  }

  const valid = dry.rowsValid ?? 0;
  const warn = dry.rowsWarning ?? 0;
  const err = dry.rowsError ?? 0;
  const total = valid + warn + err;
  const errors = dry.errors ?? [];
  const projected = dry.projected ?? {
    newMasterSkus: 0,
    autoMatches: 0,
    llmCandidates: 0,
    validationQueue: 0,
  };

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">
        3 · Validación — ¿confirmar la ingesta?
      </h2>
      <p className="text-sm text-muted-foreground mb-5">
        Resumen del dry-run. Hasta este punto nada se ha escrito en facts /
        master.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Filas válidas
            </div>
            <div className="text-2xl font-semibold mt-1">{valid}</div>
            <div className="text-xs text-muted-foreground">
              {total > 0
                ? `${((valid / total) * 100).toFixed(1)}% del archivo`
                : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Advertencias
            </div>
            <div className="text-2xl font-semibold mt-1 text-amber-600">
              {warn}
            </div>
            <div className="text-xs text-muted-foreground">
              filas con campos opcionales no parseables
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Errores
            </div>
            <div className="text-2xl font-semibold mt-1 text-rose-600">
              {err}
            </div>
            <div className="text-xs text-muted-foreground">
              filas que NO se procesarán
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <div className="bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border flex items-center justify-between">
          <span>Impacto proyectado sobre el catálogo</span>
          <span className="text-[10px] text-muted-foreground">
            F1: estimaciones simplificadas; cascada real en F2
          </span>
        </div>
        <div className="divide-y divide-border text-sm">
          <div className="px-4 py-2.5 flex items-center justify-between">
            <span>Productos nuevos que crearán master_sku</span>
            <Badge variant="info">{projected.newMasterSkus}</Badge>
          </div>
          <div className="px-4 py-2.5 flex items-center justify-between">
            <span>
              Productos que matchean automáticamente (barcode/supplier/sku)
            </span>
            <Badge variant="ok">{projected.autoMatches}</Badge>
          </div>
          <div className="px-4 py-2.5 flex items-center justify-between">
            <span>Candidatos a LLM arbiter (cascada IA)</span>
            <Badge variant="warn">{projected.llmCandidates}</Badge>
          </div>
          <div className="px-4 py-2.5 flex items-center justify-between">
            <span>Cola de validación humana esperada</span>
            <Badge variant="warn">{projected.validationQueue}</Badge>
          </div>
        </div>
      </Card>

      {errors.length > 0 && (
        <Card className="mb-6">
          <div className="bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
            Primeros {errors.length} errores
          </div>
          <div className="text-sm divide-y divide-border">
            {errors.slice(0, 50).map((e, i) => (
              <div
                key={i}
                className="px-4 py-3 flex items-center justify-between"
              >
                <div>
                  <Badge variant="err" className="mr-2">
                    fila {e.row_number}
                  </Badge>
                  {e.field && (
                    <code className="text-xs bg-muted px-1 rounded mr-1">
                      {e.field}
                    </code>
                  )}
                  {e.message}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {commitError && (
        <p className="text-sm text-destructive mb-4">Error: {commitError}</p>
      )}

      <div className="flex justify-between pt-6 border-t border-border">
        <Button variant="ghost" type="button" onClick={() => router.back()}>
          ← Ajustar mapeo
        </Button>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/operacion")}
          >
            Cancelar
          </Button>
          <Button
            variant="success"
            onClick={onConfirm}
            disabled={committing || valid === 0}
          >
            {committing
              ? "Procesando…"
              : `Confirmar e ingestar ${valid} fila${valid === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
