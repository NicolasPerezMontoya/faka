"use server";

import { redirect } from "next/navigation";
import { signIn } from "@faka/auth";
import { createClient } from "@/lib/supabase/server";

export interface SignInActionState {
  ok: boolean;
  error?: string;
}

export async function signInAction(
  _prev: SignInActionState,
  formData: FormData,
): Promise<SignInActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const redirectTo = String(formData.get("redirect") ?? "/operacion");

  const supabase = createClient();
  const result = await signIn(supabase, { email, password });

  if (!result.ok) {
    return { ok: false, error: result.error ?? "sign_in_failed" };
  }

  redirect(redirectTo);
}

export async function signOutAction() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
