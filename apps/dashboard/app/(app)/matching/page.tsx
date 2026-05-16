// /matching — F2 validation queue landing.
// Lists product_mappings rows that need human validation (score below
// MATCH_QUEUE_CUTOFF and validado_humano = false). Manager+ only — the
// route-level gate is in packages/auth/src/role-matrix.ts.
//
// Reads role from x-user-role header (W5 invariant). PII safety: this
// page never queries raw_orders.payload_json — only product_mappings +
// master_products (RESEARCH §Pitfall 9).

import Link from "next/link";
import { headers } from "next/headers";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
} from "@faka/ui";
import type { UserRole } from "@faka/schema";
import { listMappings, type MappingRow } from "./_actions/list";
import { UnmatchedItemsTable } from "./_components/unmatched-items";

export const dynamic = "force-dynamic";

const CHANNEL_LABEL: Record<string, string> = {
  wordpress: "WordPress",
  mercadolibre: "Mercado Libre",
  dropi: "Dropi",
  pos: "POS",
  whatsapp: "WhatsApp",
  falabella: "Falabella",
  "csv-upload": "CSV manual",
};

const METHOD_LABEL: Record<string, string> = {
  barcode_exact: "Barcode",
  supplier_code_exact: "Cód. proveedor",
  sku_exact: "SKU",
  normalized_name_exact: "Nombre normalizado",
  embeddings_high: "Embeddings (alto)",
  embeddings_mid: "Embeddings (medio)",
  llm_arbiter_match: "LLM (match)",
  llm_arbiter_reject: "LLM (rechazo)",
  unresolved: "Sin resolver",
};

function scoreBadgeVariant(score: number): "ok" | "warn" | "err" {
  if (score >= 0.9) return "ok";
  if (score >= 0.78) return "warn";
  return "err";
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (diffMin < 1) return "hace un momento";
  if (diffMin < 60) return `hace ${diffMin} min`;
  if (diffMin < 60 * 24) return `hace ${Math.floor(diffMin / 60)} h`;
  return date.toLocaleDateString("es-CO", { month: "short", day: "numeric" });
}

export default async function MatchingPage() {
  const role = headers().get("x-user-role") as UserRole | null;
  const rows = await listMappings({ limit: 50, status: "queue" });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Cola de validación
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Mapeos automáticos con baja confianza. Revisa cada uno y confirma o
          rechaza la sugerencia del catálogo maestro.
        </p>
      </header>

      <UnmatchedItemsTable role={role} />

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Sin pendientes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No hay mapeos pendientes de validación. Apenas lleguen ventas
              nuevas con productos no emparejados aparecerán aquí.
            </p>
          </CardContent>
        </Card>
      ) : (
        <DataTable<MappingRow>
          rows={rows}
          keyFn={(row) => row.mapping_id}
          columns={[
            {
              header: "Canal",
              cell: (row) => (
                <Badge variant="muted">
                  {CHANNEL_LABEL[row.canal] ?? row.canal}
                </Badge>
              ),
            },
            {
              header: "Producto del canal",
              cell: (row) => (
                <div>
                  <div className="font-medium">
                    {row.external_name ?? row.external_id}
                  </div>
                  {row.external_sku && (
                    <div className="text-xs text-muted-foreground font-mono">
                      {row.external_sku}
                    </div>
                  )}
                </div>
              ),
            },
            {
              header: "Sugerencia maestro",
              cell: (row) => (
                <div>
                  <div className="font-medium">
                    {row.nombre_canonico ?? "— sin maestro —"}
                  </div>
                  {row.brand && (
                    <div className="text-xs text-muted-foreground">
                      {row.brand}
                    </div>
                  )}
                </div>
              ),
            },
            {
              header: "Score",
              thClassName: "text-right",
              className: "text-right",
              cell: (row) => (
                <Badge variant={scoreBadgeVariant(row.score)}>
                  {row.score.toFixed(2)}
                </Badge>
              ),
            },
            {
              header: "Método",
              cell: (row) => (
                <span className="text-xs text-muted-foreground">
                  {METHOD_LABEL[row.match_method] ?? row.match_method}
                </span>
              ),
            },
            {
              header: "Detectado",
              cell: (row) => (
                <span className="text-xs text-muted-foreground">
                  {formatTime(row.created_at)}
                </span>
              ),
            },
            {
              header: "",
              thClassName: "text-right",
              className: "text-right",
              cell: (row) => (
                <Link
                  href={`/matching/${row.mapping_id}`}
                  className="text-sm font-medium hover:underline"
                >
                  Revisar →
                </Link>
              ),
            },
          ]}
          emptyState="Sin mapeos pendientes."
        />
      )}

      {role && (
        <p className="mt-6 text-xs text-muted-foreground">
          Sesión como <span className="font-medium">{role}</span>. Las acciones
          de validación quedan registradas con tu identidad.
        </p>
      )}
    </div>
  );
}
