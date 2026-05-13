/**
 * sign-in — wraps supabase.auth.signInWithPassword.
 *
 * Email + password is the only auth method in F1 (per RESEARCH §3 Claude's
 * Discretion). Magic link / OAuth can be added in F2+ if cliente requests.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface SignInInput {
  email: string;
  password: string;
}

export interface SignInResult {
  ok: boolean;
  error?: string;
}

export async function signIn(supabase: SupabaseClient, input: SignInInput): Promise<SignInResult> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password) {
    return { ok: false, error: 'missing_credentials' };
  }

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: input.password,
  });

  if (error) {
    // Avoid leaking which credential was wrong.
    return { ok: false, error: 'invalid_credentials' };
  }

  return { ok: true };
}
