// Upload wizard host — picks the step component based on ?step= URL param.
// State lives in URL (per CONTEXT.md "Specific Ideas") so the user can copy
// the link, refresh, or navigate back/forward without losing context.

import { Stepper, Card, CardContent } from "@faka/ui";
import { createClient } from "@/lib/supabase/server";
import { StepSource } from "./_components/step-source";
import { StepMapping } from "./_components/step-mapping";
import { StepValidate } from "./_components/step-validate";

const STEPS = [
  { label: "Fuente" },
  { label: "Mapeo de columnas" },
  { label: "Validar y confirmar" },
];

interface SearchParams {
  step?: string;
  channel?: string;
  tipo?: string;
  profile?: string;
  upload?: string;
}

export default async function UploadWizardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const step = Math.max(1, Math.min(3, Number(searchParams.step ?? 1)));
  const supabase = createClient();

  // Fetch profiles for step 1 (server-side).
  const { data: profiles } = await supabase
    .from("csv_mapping_profiles")
    .select("id, nombre, canal, tipo, version, is_active")
    .eq("is_active", true)
    .order("canal", { ascending: true })
    .order("version", { ascending: false });

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Subir CSV</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          El archivo crudo se almacena íntegro y reprocesable. Las filas pasan
          por el pipeline de matching y aparecen en los marts al finalizar.
        </p>
      </header>

      <Stepper steps={STEPS} active={step} className="mb-8" />

      <Card>
        <CardContent className="p-6">
          {step === 1 && (
            <StepSource
              profiles={profiles ?? []}
              defaultChannel={searchParams.channel ?? null}
              defaultTipo={searchParams.tipo ?? null}
              defaultProfileId={searchParams.profile ?? null}
            />
          )}
          {step === 2 && (
            <StepMapping
              channel={searchParams.channel ?? null}
              tipo={searchParams.tipo ?? null}
              profileId={searchParams.profile ?? null}
              uploadId={searchParams.upload ?? null}
              profiles={profiles ?? []}
            />
          )}
          {step === 3 && (
            <StepValidate
              uploadId={searchParams.upload ?? null}
              profileId={searchParams.profile ?? null}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
