// Step 2 (Mapeo) — design from docs/sketches/csv-upload-wizard.html:164-280
// Client Component: parses first ~3 CSV rows locally for preview + auto-detect
// hints, then submits file to upload-csv Server Action on "Continuar".

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Dropzone,
  Badge,
  Toggle,
  MappingTable,
  type MappingRow,
} from "@faka/ui";
import { autoDetectAction } from "../_actions/auto-detect";
import { uploadCsvAndAdvance } from "../_actions/upload-csv";
import { saveMappingAction } from "../_actions/save-mapping";

const CSV_MAX_BYTES = 20 * 1024 * 1024;
const PREVIEW_ROWS = 3;

const CANONICAL_FIELDS_PRODUCTS: MappingRow[] = [
  {
    field: "external_id",
    required: true,
    sourceColumn: null,
    confidence: "none",
  },
  { field: "name", required: true, sourceColumn: null, confidence: "none" },
  { field: "sku", sourceColumn: null, confidence: "none" },
  { field: "price", required: true, sourceColumn: null, confidence: "none" },
  { field: "cost", sourceColumn: null, confidence: "none" },
  { field: "barcode", sourceColumn: null, confidence: "none" },
  { field: "supplier_code", sourceColumn: null, confidence: "none" },
  { field: "category", sourceColumn: null, confidence: "none" },
  { field: "brand", sourceColumn: null, confidence: "none" },
  { field: "image_url", sourceColumn: null, confidence: "none" },
  { field: "status", sourceColumn: null, confidence: "none" },
];

const CANONICAL_FIELDS_ORDERS: MappingRow[] = [
  {
    field: "external_order_id",
    required: true,
    sourceColumn: null,
    confidence: "none",
  },
  {
    field: "order_date",
    required: true,
    sourceColumn: null,
    confidence: "none",
  },
  { field: "total", required: true, sourceColumn: null, confidence: "none" },
  { field: "subtotal", sourceColumn: null, confidence: "none" },
  { field: "discount", sourceColumn: null, confidence: "none" },
  { field: "shipping_cost", sourceColumn: null, confidence: "none" },
  { field: "status", sourceColumn: null, confidence: "none" },
  { field: "customer_phone", sourceColumn: null, confidence: "none" },
  { field: "customer_email", sourceColumn: null, confidence: "none" },
  { field: "customer_name", sourceColumn: null, confidence: "none" },
  { field: "payment_method", sourceColumn: null, confidence: "none" },
];

function splitCsvLine(line: string, delimiter = ","): string[] {
  // Lightweight CSV split for preview-only. Handles quoted fields with commas.
  // Production parse runs server-side via csv-parse in commit-upload.
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result.map((c) => c.trim());
}

async function previewCsv(
  file: File,
): Promise<{ headers: string[]; rows: string[][] }> {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]!);
  const rows = lines.slice(1, 1 + PREVIEW_ROWS).map((l) => splitCsvLine(l));
  return { headers, rows };
}

export interface StepMappingProps {
  channel: string | null;
  tipo: string | null;
  profileId: string | null;
  uploadId: string | null;
  profiles: Array<{
    id: string;
    nombre: string;
    canal: string;
    tipo: string;
    version: number;
    is_active: boolean;
  }>;
}

export function StepMapping({
  channel,
  tipo,
  profileId,
  profiles,
}: StepMappingProps) {
  const router = useRouter();
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<{
    headers: string[];
    rows: string[][];
  } | null>(null);
  const [mapping, setMapping] = React.useState<MappingRow[]>(
    tipo === "orders" ? CANONICAL_FIELDS_ORDERS : CANONICAL_FIELDS_PRODUCTS,
  );
  const [saveAsNewVersion, setSaveAsNewVersion] = React.useState(false);
  const [profileNombre, setProfileNombre] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!profileId) return;
    const profile = profiles.find((p) => p.id === profileId);
    if (profile) setProfileNombre(profile.nombre);
  }, [profileId, profiles]);

  async function onFileSelected(picked: File) {
    setFile(picked);
    setError(null);
    const prev = await previewCsv(picked);
    setPreview(prev);

    if (channel && prev.headers.length > 0) {
      const result = await autoDetectAction({ channel, headers: prev.headers });
      if (result.ok) {
        setMapping((prevMapping) =>
          prevMapping.map((row) => {
            const suggested = result.suggestions.find(
              (s) => s.field === row.field,
            );
            if (!suggested) return row;
            return {
              ...row,
              sourceColumn: suggested.sourceColumn,
              confidence: suggested.confidence,
            };
          }),
        );
      }
    }
  }

  function onMappingChange(idx: number, sourceColumn: string | null) {
    setMapping((prev) => {
      const next = [...prev];
      const row = next[idx];
      if (row) {
        next[idx] = {
          ...row,
          sourceColumn,
          confidence: sourceColumn ? "mid" : "none",
        };
      }
      return next;
    });
  }

  const autoCount = mapping.filter((m) => m.confidence === "high").length;
  const requiredMissing = mapping.filter(
    (m) => m.required && !m.sourceColumn,
  ).length;
  const canSubmit =
    file !== null && channel !== null && tipo !== null && requiredMissing === 0;

  async function onContinue(formData: FormData) {
    if (!canSubmit || !file || !channel || !tipo) return;
    setSubmitting(true);
    setError(null);

    try {
      let effectiveProfileId = profileId ?? "";
      if (saveAsNewVersion) {
        const columnMap = Object.fromEntries(
          mapping
            .filter((m) => m.sourceColumn)
            .map((m) => [m.field, m.sourceColumn as string]),
        );
        const saveFd = new FormData();
        saveFd.set("channel", channel);
        saveFd.set("tipo", tipo);
        saveFd.set("nombre", profileNombre || `${channel} · ${tipo} · adhoc`);
        saveFd.set("column_map", JSON.stringify(columnMap));
        const saved = await saveMappingAction(saveFd);
        if (!saved.ok || !saved.profile_id) {
          setError(saved.error ?? "save_mapping_failed");
          setSubmitting(false);
          return;
        }
        effectiveProfileId = saved.profile_id;
      }

      formData.set("file", file);
      formData.set("channel", channel);
      formData.set("tipo", tipo);
      if (effectiveProfileId) formData.set("profileId", effectiveProfileId);
      await uploadCsvAndAdvance(formData);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">
        2 · Sube el archivo y confirma el mapeo de columnas
      </h2>
      <p className="text-sm text-muted-foreground mb-5">
        Canal: <strong>{channel}</strong> · Tipo: <strong>{tipo}</strong>
      </p>

      <Dropzone
        onFileSelected={onFileSelected}
        accept=".csv,text/csv"
        maxBytes={CSV_MAX_BYTES}
        current={
          file ? (
            <Badge variant="info">
              {file.name} · {(file.size / 1024).toFixed(1)} KB ·{" "}
              {preview?.rows.length ?? 0} filas en vista previa
            </Badge>
          ) : null
        }
      />

      {preview && preview.headers.length > 0 && (
        <>
          <h3 className="text-sm font-semibold mt-6 mb-2">Vista previa</h3>
          <div className="overflow-x-auto border border-border rounded-lg bg-card">
            <table className="w-full text-xs">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  {preview.headers.map((h, i) => (
                    <th key={i} className="px-3 py-2 text-left font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className="px-3 py-2">
                        {cell || (
                          <span className="text-muted-foreground/40">·</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-end justify-between mt-6 mb-2">
            <h3 className="text-sm font-semibold">Mapeo de columnas</h3>
            <div className="text-xs">
              <Badge variant="ok" className="mr-1">
                {autoCount} auto-detectadas
              </Badge>
              {requiredMissing > 0 && (
                <Badge variant="err">{requiredMissing} requeridas faltan</Badge>
              )}
            </div>
          </div>

          <MappingTable
            rows={mapping}
            availableSourceColumns={preview.headers}
            onChange={onMappingChange}
          />

          <div className="mt-5 bg-muted/40 border border-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm">
                <div className="font-medium">
                  Guardar como nueva versión del perfil
                </div>
                <div className="text-xs text-muted-foreground">
                  El perfil se versiona automáticamente; uploads viejos pueden
                  reprocesarse con la versión nueva.
                </div>
              </div>
              <Toggle
                checked={saveAsNewVersion}
                onChange={(e) => setSaveAsNewVersion(e.currentTarget.checked)}
              />
            </div>
            {saveAsNewVersion && (
              <input
                type="text"
                value={profileNombre}
                onChange={(e) => setProfileNombre(e.target.value)}
                placeholder="Nombre del perfil (ej: 'WordPress · Export productos')"
                className="mt-2 w-full h-9 border border-input rounded-lg px-3 text-sm bg-card"
              />
            )}
          </div>
        </>
      )}

      {error && <p className="text-sm text-destructive mt-4">Error: {error}</p>}

      <form
        action={onContinue}
        className="flex justify-between mt-6 pt-6 border-t border-border"
      >
        <Button
          variant="ghost"
          type="button"
          onClick={() =>
            router.push(
              `/operacion/upload?step=1&channel=${channel ?? ""}&tipo=${tipo ?? ""}`,
            )
          }
        >
          ← Atrás
        </Button>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/operacion")}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={!canSubmit || submitting}>
            {submitting ? "Subiendo…" : "Validar →"}
          </Button>
        </div>
      </form>
    </div>
  );
}
