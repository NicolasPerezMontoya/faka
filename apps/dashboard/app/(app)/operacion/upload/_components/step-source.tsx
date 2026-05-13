// Step 1: source picker — design from docs/sketches/csv-upload-wizard.html:88-162

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Select, Badge } from "@faka/ui";

interface Profile {
  id: string;
  nombre: string;
  canal: string;
  tipo: string;
  version: number;
  is_active: boolean;
}

interface ChannelMeta {
  value: string;
  label: string;
  hint: string;
  disabled?: boolean;
  disabledReason?: string;
}

const CHANNELS: ChannelMeta[] = [
  { value: "wordpress", label: "WordPress", hint: "Pedidos + productos" },
  {
    value: "mercadolibre",
    label: "Mercado Libre",
    hint: "Pedidos + productos",
  },
  { value: "dropi", label: "Dropi", hint: "Fallback del scraper" },
  { value: "pos", label: "POS físico", hint: "Punto 1 o Punto 2" },
  { value: "whatsapp", label: "WhatsApp", hint: "Solo pedidos manuales" },
  {
    value: "falabella",
    label: "Falabella",
    hint: "Deshabilitado en F1",
    disabled: true,
    disabledReason: "Fase 6",
  },
];

const TIPOS = ["products", "orders", "order_items", "inventory"] as const;

const TIPO_LABEL: Record<(typeof TIPOS)[number], string> = {
  products: "Productos",
  orders: "Pedidos",
  order_items: "Líneas de pedido",
  inventory: "Inventario",
};

export interface StepSourceProps {
  profiles: Profile[];
  defaultChannel: string | null;
  defaultTipo: string | null;
  defaultProfileId: string | null;
}

export function StepSource({
  profiles,
  defaultChannel,
  defaultTipo,
  defaultProfileId,
}: StepSourceProps) {
  const router = useRouter();
  const [channel, setChannel] = React.useState<string | null>(defaultChannel);
  const [tipo, setTipo] = React.useState<string>(defaultTipo ?? "products");
  const [profileId, setProfileId] = React.useState<string | null>(
    defaultProfileId,
  );

  const matchingProfiles = profiles.filter(
    (p) => p.canal === channel && p.tipo === tipo,
  );

  function next() {
    if (!channel) return;
    const params = new URLSearchParams();
    params.set("step", "2");
    params.set("channel", channel);
    params.set("tipo", tipo);
    if (profileId) params.set("profile", profileId);
    router.push(`/operacion/upload?${params.toString()}`);
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">
        1 · ¿De qué canal y qué tipo es este CSV?
      </h2>
      <p className="text-sm text-muted-foreground mb-5">
        El payload crudo se almacena en{" "}
        <code className="text-xs">raw_csv_uploads</code>; reprocesable con
        cualquier versión del perfil.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium mb-2">Canal</label>
          <div className="grid grid-cols-2 gap-2">
            {CHANNELS.map((ch) => {
              const selected = channel === ch.value;
              return (
                <button
                  key={ch.value}
                  type="button"
                  disabled={ch.disabled}
                  onClick={() => !ch.disabled && setChannel(ch.value)}
                  className={[
                    "px-3 py-3 rounded-lg border text-sm text-left transition-colors",
                    selected
                      ? "border-primary ring-2 ring-primary/10"
                      : "border-input",
                    ch.disabled
                      ? "opacity-50 cursor-not-allowed"
                      : "hover:border-primary",
                  ].join(" ")}
                >
                  <div className="font-medium">{ch.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {ch.disabled ? (ch.disabledReason ?? ch.hint) : ch.hint}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2">Tipo</label>
            <div className="flex flex-wrap gap-2">
              {TIPOS.map((t) => (
                <label
                  key={t}
                  className={[
                    "px-3 py-2 border rounded-lg text-sm cursor-pointer transition-colors",
                    tipo === t
                      ? "border-primary ring-2 ring-primary/10"
                      : "border-input hover:border-primary",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    name="tipo"
                    value={t}
                    checked={tipo === t}
                    onChange={() => setTipo(t)}
                    className="sr-only"
                  />
                  {TIPO_LABEL[t]}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Perfil de mapping
            </label>
            <Select
              value={profileId ?? ""}
              onChange={(e) =>
                setProfileId(e.target.value === "" ? null : e.target.value)
              }
              disabled={!channel}
            >
              <option value="">— crear nuevo en el paso 2 —</option>
              {matchingProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} (v{p.version})
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Selecciona un perfil existente para auto-completar el mapeo, o
              créalo en el siguiente paso.
            </p>
          </div>

          {channel === "falabella" && (
            <Badge variant="warn">
              Canal deshabilitado por feature flag (F6).
            </Badge>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-6 pt-6 border-t border-border">
        <Button variant="ghost" onClick={() => router.push("/operacion")}>
          Cancelar
        </Button>
        <Button onClick={next} disabled={!channel}>
          Siguiente →
        </Button>
      </div>
    </div>
  );
}
