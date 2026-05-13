import type { SupabaseClient } from '@supabase/supabase-js';

export async function signOut(supabase: SupabaseClient): Promise<void> {
  await supabase.auth.signOut();
}
