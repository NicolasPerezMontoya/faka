"use client";

import { useFormState, useFormStatus } from "react-dom";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@faka/ui";
import { signInAction, type SignInActionState } from "./_actions";

const initialState: SignInActionState = { ok: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} size="lg" className="w-full">
      {pending ? "Entrando…" : "Iniciar sesión"}
    </Button>
  );
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: { redirect?: string };
}) {
  const [state, formAction] = useFormState(signInAction, initialState);

  return (
    <div className="min-h-screen grid place-items-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Iniciar sesión</CardTitle>
          <CardDescription>
            faka — Dashboard Omnicanal de Ventas
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="email">
                Correo electrónico
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="w-full h-9 border border-input rounded-lg px-3 text-sm bg-card"
              />
            </div>
            <div>
              <label
                className="block text-sm font-medium mb-1"
                htmlFor="password"
              >
                Contraseña
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="w-full h-9 border border-input rounded-lg px-3 text-sm bg-card"
              />
            </div>
            <input
              type="hidden"
              name="redirect"
              value={searchParams.redirect ?? "/operacion"}
            />
            {state.error && (
              <p className="text-xs text-destructive">
                {state.error === "invalid_credentials"
                  ? "Credenciales inválidas. Verifica el email y la contraseña."
                  : state.error === "missing_credentials"
                    ? "Email y contraseña son obligatorios."
                    : `Error: ${state.error}`}
              </p>
            )}
            <SubmitButton />
            <p className="text-xs text-muted-foreground text-center">
              ¿Olvidaste tu contraseña? Pídele a un Super Admin que la resetee.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
