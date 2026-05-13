-- Migration 0010 — Row-level RLS baseline + helper grants.
-- Phase 1 / Plan 1.1.6.
--
-- RLS is enabled on every user-readable table. Read access is granted
-- via the per-role VIEWS in migration 0011, NOT via row policies on the
-- base tables — base tables get `revoke ... from authenticated` in 0012.
--
-- Mutations (INSERT/UPDATE/DELETE) always run with the service-role key
-- from Server Actions (Next.js) or the orchestrator. RLS bypass on the
-- service role is by design — Server Actions enforce role authorization
-- in TypeScript before writing.
--
-- Why this pattern (RESEARCH §3): SECURITY INVOKER views require the
-- caller (authenticated) to have row-level access to the base table.
-- We enable RLS + add a baseline SELECT policy so views work for any
-- authenticated user; column projection is enforced by the view itself.

-- Enable RLS on every user-readable table.
alter table public.sales                       enable row level security;
alter table public.sale_items                  enable row level security;
alter table public.inventory_snapshots         enable row level security;
alter table public.master_products             enable row level security;
alter table public.master_categories           enable row level security;
alter table public.category_mappings           enable row level security;
alter table public.product_mappings            enable row level security;
alter table public.product_variants            enable row level security;
alter table public.customers                   enable row level security;
alter table public.customer_external_links     enable row level security;
alter table public.customer_merge_log          enable row level security;
alter table public.raw_csv_uploads             enable row level security;
alter table public.raw_csv_rows                enable row level security;
alter table public.csv_mapping_profiles        enable row level security;
alter table public.raw_orders                  enable row level security;
alter table public.raw_products                enable row level security;
alter table public.raw_events                  enable row level security;
alter table public.ai_insights                 enable row level security;
alter table public.ai_conversations            enable row level security;
alter table public.messaging_log               enable row level security;
alter table public.connector_runs              enable row level security;
alter table public.audit_log                   enable row level security;
alter table public.dead_letter_queue           enable row level security;

-- Mart tables also have RLS so the projection rule is enforced uniformly.
alter table public.mart_top_products_by_window enable row level security;
alter table public.mart_channel_performance    enable row level security;
alter table public.mart_product_velocity       enable row level security;
alter table public.mart_dead_stock             enable row level security;
alter table public.mart_days_of_inventory      enable row level security;
alter table public.mart_cannibalization        enable row level security;

------------------------------------------------------------------------------
-- Baseline policies — authenticated users can SELECT base tables (so
-- SECURITY INVOKER views can read them). No INSERT/UPDATE/DELETE policies
-- for the authenticated role; mutations are service-role only.
------------------------------------------------------------------------------

do $$
declare
  t text;
  tables text[] := array[
    'sales','sale_items','inventory_snapshots',
    'master_products','master_categories','category_mappings',
    'product_mappings','product_variants',
    'customers','customer_external_links','customer_merge_log',
    'raw_csv_uploads','raw_csv_rows','csv_mapping_profiles',
    'raw_orders','raw_products','raw_events',
    'ai_insights','ai_conversations','messaging_log',
    'connector_runs','audit_log','dead_letter_queue',
    'mart_top_products_by_window','mart_channel_performance',
    'mart_product_velocity','mart_dead_stock','mart_days_of_inventory',
    'mart_cannibalization'
  ];
begin
  foreach t in array tables loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (auth.uid() is not null)',
      'authenticated_select_' || t,
      t
    );
  end loop;
end $$;

------------------------------------------------------------------------------
-- Special-case Mini-CRM: customers and customer_external_links should only
-- be readable through the views, but the views require base SELECT. The
-- view filter handles role enforcement (zero rows for manager/analista).
-- Same goes for audit_log — view layer enforces who can read what.
------------------------------------------------------------------------------

-- Self-read on ai_conversations: a user can read THEIR own chat history.
create policy ai_conversations_self_read
  on public.ai_conversations
  for select
  to authenticated
  using (user_id = auth.uid() or current_role_claim() in ('super_admin', 'admin'));

-- Drop the generic policy and use the self-policy instead.
drop policy authenticated_select_ai_conversations on public.ai_conversations;
