// STUB — placeholder until first `pnpm db:types` run generates the real
// types from a live Supabase project. CI's db-integration job overwrites
// this file with `supabase gen types typescript --local` once migrations
// have been applied.
//
// Do NOT hand-edit. To refresh locally:
//   pnpm --filter @faka/db run types
//
// Phase 1: this stub exists so `tsc --noEmit` in the lint-test job can
// resolve `@faka/db` imports before db-integration has run.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
