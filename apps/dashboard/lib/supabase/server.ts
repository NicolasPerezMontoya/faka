// Supabase server-side client (Server Components + Server Actions).
// Uses @supabase/ssr cookies adapter so auth cookies survive across requests.

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@faka/db/types';

export function createClient() {
  const cookieStore = cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component (which can't set cookies) — middleware
            // handles refresh tokens; ignore.
          }
        },
      },
    },
  );
}

/**
 * Service-role client. Use ONLY in Server Actions / API routes for privileged
 * operations (CSV upload, seeder, audit log writes). NEVER expose to the
 * browser — eslint rule blocks NEXT_PUBLIC_* names with SERVICE/SECRET.
 */
export function createServiceRoleClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  }

  return createServerClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        // Service-role calls never set auth cookies.
      },
    },
  });
}
