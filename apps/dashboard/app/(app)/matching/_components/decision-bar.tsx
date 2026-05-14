"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Badge } from "@faka/ui";
import { validateMapping } from "../_actions/validate-mapping";
import { rejectMapping } from "../_actions/reject-mapping";

export function DecisionBar({
  mappingId,
  alreadyValidated,
}: {
  mappingId: string;
  alreadyValidated: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (alreadyValidated) {
    return <Badge variant="ok">Ya validado</Badge>;
  }

  const handle = (
    action: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>,
  ) => {
    setError(null);
    startTransition(async () => {
      const result = await action(mappingId);
      if (result.ok) {
        router.push("/matching");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex items-center gap-3">
      {error && (
        <span className="text-xs text-destructive">Error: {error}</span>
      )}
      <Button
        variant="destructive"
        disabled={pending}
        onClick={() => handle(rejectMapping)}
      >
        {pending ? "..." : "Rechazar"}
      </Button>
      <Button
        variant="success"
        disabled={pending}
        onClick={() => handle(validateMapping)}
      >
        {pending ? "..." : "Aceptar"}
      </Button>
    </div>
  );
}
