// /matching/[mappingId] — F2 side-by-side comparison.
// Left column: the channel's product (no customer data — ever, even
// for admin). Right column: the master_products suggestion + cascade
// metadata. Action bar wires to Plan 2.4.3 Server Actions (validate /
// reject) — current shell renders disabled buttons until those land.
//
// PII safety: this page never queries raw_orders.payload_json. Both
// columns stay product-only by design (RESEARCH §Pitfall 9).

import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@faka/ui";
import type { UserRole } from "@faka/schema";
import { getMappingDetail } from "../_actions/get-detail";

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

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`mt-1 text-sm ${
          mono ? "font-mono" : ""
        } ${value ? "" : "text-muted-foreground italic"}`}
      >
        {value ?? "sin dato"}
      </dd>
    </div>
  );
}

export default async function MatchingDetailPage({
  params,
}: {
  params: { mappingId: string };
}) {
  const role = headers().get("x-user-role") as UserRole | null;
  const detail = await getMappingDetail(params.mappingId);
  if (!detail) notFound();

  const alreadyValidated = detail.validado_humano;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <Link
          href="/matching"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Volver a la cola
        </Link>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{detail.mapping_id.slice(0, 8)}</span>
          <Badge variant="muted">
            {CHANNEL_LABEL[detail.canal] ?? detail.canal}
          </Badge>
          <Badge variant={scoreBadgeVariant(detail.score)}>
            score {detail.score.toFixed(2)}
          </Badge>
          <span>{METHOD_LABEL[detail.match_method] ?? detail.match_method}</span>
        </div>
      </div>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Revisar emparejamiento
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Compara el producto que llegó por el canal con la sugerencia del
          catálogo maestro y acepta o rechaza el match.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Producto del canal
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {CHANNEL_LABEL[detail.canal] ?? detail.canal}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              <Field label="Nombre" value={detail.external_name} />
              <Field label="ID externo" value={detail.external_id} mono />
              <Field label="SKU del canal" value={detail.external_sku} mono />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Candidato maestro
              <span className="ml-2 text-xs font-normal text-muted-foreground font-mono">
                {detail.master_sku.slice(0, 8)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              <Field label="Nombre canónico" value={detail.master_nombre} />
              <Field label="Marca" value={detail.master_brand} />
              <Field label="Categoría" value={detail.master_category} />
              <Field label="Código de barras" value={detail.master_barcode} mono />
              <Field
                label="Código de proveedor"
                value={detail.master_supplier_code}
                mono
              />
            </dl>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 flex items-center justify-end gap-3">
        {alreadyValidated ? (
          <Badge variant="ok">Ya validado</Badge>
        ) : (
          <>
            <Button variant="destructive" disabled title="Pendiente: plan 2.4.3">
              Rechazar
            </Button>
            <Button variant="success" disabled title="Pendiente: plan 2.4.3">
              Aceptar
            </Button>
          </>
        )}
      </div>

      {role && (
        <p className="mt-6 text-xs text-muted-foreground text-right">
          Sesión como <span className="font-medium">{role}</span>.
        </p>
      )}
    </div>
  );
}
