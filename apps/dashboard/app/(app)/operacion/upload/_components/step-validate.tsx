// Step 3 placeholder (real impl in Plan 1.3.5).

'use client';

export interface StepValidateProps {
  uploadId: string | null;
  profileId: string | null;
}

export function StepValidate(_props: StepValidateProps) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">3 · Validar y confirmar</h2>
      <p className="text-sm text-muted-foreground">Implementación real en Plan 1.3.5.</p>
    </div>
  );
}
