#!/usr/bin/env node
/**
 * Seed the initial Super Admin user.
 *
 * Phase 1 / Plan 1.1.7.
 *
 * Idempotent:
 *  - If the user already exists, only the profile row is upserted.
 *  - If the profile already exists, the role is re-affirmed to 'super_admin'.
 *  - Safe to re-run after `supabase db reset` or in CI smoke tests.
 *
 * Required env (loaded automatically via `node --env-file-if-exists=.env`):
 *  - SUPABASE_URL                       — local dev: http://127.0.0.1:54321
 *  - SUPABASE_SERVICE_ROLE_KEY          — local dev: from `supabase status`
 *  - INITIAL_SUPER_ADMIN_EMAIL          — defaults to nicolasperezmontoya@gmail.com per ADR-002:47
 *  - INITIAL_SUPER_ADMIN_PASSWORD       — required. Rotate after first login.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INITIAL_SUPER_ADMIN_EMAIL =
  process.env.INITIAL_SUPER_ADMIN_EMAIL ?? "nicolasperezmontoya@gmail.com";
const INITIAL_SUPER_ADMIN_PASSWORD = process.env.INITIAL_SUPER_ADMIN_PASSWORD;

function assertEnv(name: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    console.error(`❌ Missing required env: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const url = assertEnv("SUPABASE_URL", SUPABASE_URL);
  const key = assertEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY);
  const password = assertEnv(
    "INITIAL_SUPER_ADMIN_PASSWORD",
    INITIAL_SUPER_ADMIN_PASSWORD,
  );

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`🔐 Seeding Super Admin: ${INITIAL_SUPER_ADMIN_EMAIL}`);

  // Step 1: ensure auth.users row exists.
  const { data: existingList, error: listErr } =
    await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 100,
    });
  if (listErr) {
    console.error(`❌ Failed to list users: ${listErr.message}`);
    process.exit(1);
  }

  let userId: string | null =
    existingList.users.find(
      (u) => u.email?.toLowerCase() === INITIAL_SUPER_ADMIN_EMAIL.toLowerCase(),
    )?.id ?? null;

  if (!userId) {
    const { data: created, error: createErr } =
      await supabase.auth.admin.createUser({
        email: INITIAL_SUPER_ADMIN_EMAIL,
        password,
        email_confirm: true,
        app_metadata: { role: "super_admin" },
      });
    if (createErr || !created.user) {
      console.error(
        `❌ Failed to create user: ${createErr?.message ?? "unknown"}`,
      );
      process.exit(1);
    }
    userId = created.user.id;
    console.log(`   ✓ Created auth.users row ${userId}`);
  } else {
    console.log(
      `   - auth.users row already exists (${userId}) — skipping create`,
    );
  }

  // Step 2: upsert profile row with role=super_admin.
  const { error: upsertErr } = await supabase.from("profiles").upsert(
    {
      user_id: userId,
      email: INITIAL_SUPER_ADMIN_EMAIL,
      role: "super_admin",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (upsertErr) {
    console.error(`❌ Failed to upsert profile: ${upsertErr.message}`);
    process.exit(1);
  }
  console.log(
    `   ✓ profiles.role = 'super_admin' for ${INITIAL_SUPER_ADMIN_EMAIL}`,
  );

  console.log(
    `✅ Done. Log in with ${INITIAL_SUPER_ADMIN_EMAIL} / <INITIAL_SUPER_ADMIN_PASSWORD>.`,
  );
  console.log(
    `   Reminder: rotate the password from the dashboard after first login.`,
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
