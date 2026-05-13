// Step 2 placeholder (real impl in Plan 1.3.4).
// Defined here so the wizard host doesn't break at compile time.

'use client';

export interface StepMappingProps {
  channel: string | null;
  tipo: string | null;
  profileId: string | null;
  uploadId: string | null;
  profiles: Array<{ id: string; nombre: string; canal: string; tipo: string; version: number; is_active: boolean }>;
}

export function StepMapping(_props: StepMappingProps) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">2 · Mapeo de columnas</h2>
      <p className="text-sm text-muted-foreground">Implementación real en Plan 1.3.4.</p>
    </div>
  );
}
