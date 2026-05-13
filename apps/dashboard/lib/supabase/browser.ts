// Supabase browser-side client. Used by Client Components only.

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@faka/db/types';

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
