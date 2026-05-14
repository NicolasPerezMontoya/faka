-- scripts/seed-demo-data.sql
--
-- Demo seed for client review meeting. Pure data — no schema changes.
-- Idempotent: safe to re-run; uses `on conflict do nothing` everywhere
-- so it never duplicates rows.
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/seed-demo-data.sql
-- or via Supabase Studio SQL editor.
--
-- Inserts:
--   - 6 master_products
--   - 12 sales today (mixed wordpress / csv-upload, all 'pagado')
--   - 24 sale_items (with master_sku where the demo wants /hoy populated,
--     external_product_id where the /matching queue wants candidates)
--   - 4 product_mappings with score < 0.78 (queue rows for the demo)

-- 1. Master products ---------------------------------------------------

insert into public.master_products
  (master_sku, nombre_canonico, brand, category, barcode, supplier_code, estado)
values
  ('11111111-1111-1111-1111-111111111101'::uuid,
   'Tinte para cabello rubio dorado 60ml', 'Capilatis', 'Belleza',
   '7794000000011', 'CAP-RUB-001', 'activo'),
  ('11111111-1111-1111-1111-111111111102'::uuid,
   'Crema hidratante facial 50ml', 'NaturaSkin', 'Belleza',
   '7794000000028', 'NAT-CRM-050', 'activo'),
  ('11111111-1111-1111-1111-111111111103'::uuid,
   'Plancha alisadora cerámica 230°C', 'GoldenSilk', 'Electrodomésticos',
   '7794000000035', 'GLD-PLC-230', 'activo'),
  ('11111111-1111-1111-1111-111111111104'::uuid,
   'Set de brochas maquillaje x12', 'BeautyPro', 'Belleza',
   '7794000000042', 'BTP-BR-12', 'activo'),
  ('11111111-1111-1111-1111-111111111105'::uuid,
   'Mascarilla anti-edad con colágeno', 'NaturaSkin', 'Belleza',
   '7794000000059', 'NAT-MSK-COL', 'activo'),
  ('11111111-1111-1111-1111-111111111106'::uuid,
   'Aceite capilar argán 100ml', 'Capilatis', 'Belleza',
   '7794000000066', 'CAP-ACT-ARG', 'activo')
on conflict (master_sku) do nothing;

-- 2. Sales today (America/Bogota) -------------------------------------

insert into public.sales
  (sale_id, canal, external_order_id, fecha, created_at, estado, total,
   customer_name, payment_method)
values
  ('22222222-2222-2222-2222-222222222201'::uuid, 'wordpress',
   'wp-1001', (now() at time zone 'America/Bogota')::date,
   now() - interval '5 minutes', 'pagado', 89000,
   'Carolina Rodríguez', 'tarjeta'),
  ('22222222-2222-2222-2222-222222222202'::uuid, 'wordpress',
   'wp-1002', (now() at time zone 'America/Bogota')::date,
   now() - interval '12 minutes', 'pagado', 145000,
   'Luis Felipe Torres', 'pse'),
  ('22222222-2222-2222-2222-222222222203'::uuid, 'wordpress',
   'wp-1003', (now() at time zone 'America/Bogota')::date,
   now() - interval '23 minutes', 'pagado', 67000,
   'Andrea Martínez', 'tarjeta'),
  ('22222222-2222-2222-2222-222222222204'::uuid, 'csv-upload',
   'csv-2001', (now() at time zone 'America/Bogota')::date,
   now() - interval '40 minutes', 'pagado', 230000,
   'Diana Salazar', 'efectivo'),
  ('22222222-2222-2222-2222-222222222205'::uuid, 'wordpress',
   'wp-1004', (now() at time zone 'America/Bogota')::date,
   now() - interval '55 minutes', 'pagado', 178000,
   'Camilo Vargas', 'tarjeta'),
  ('22222222-2222-2222-2222-222222222206'::uuid, 'csv-upload',
   'csv-2002', (now() at time zone 'America/Bogota')::date,
   now() - interval '1 hour 15 minutes', 'pagado', 95000,
   'Paola Ramírez', 'pse'),
  ('22222222-2222-2222-2222-222222222207'::uuid, 'wordpress',
   'wp-1005', (now() at time zone 'America/Bogota')::date,
   now() - interval '1 hour 40 minutes', 'pagado', 112000,
   'Mauricio Ospina', 'tarjeta'),
  ('22222222-2222-2222-2222-222222222208'::uuid, 'csv-upload',
   'csv-2003', (now() at time zone 'America/Bogota')::date,
   now() - interval '2 hours 5 minutes', 'pagado', 56000,
   'Valentina López', 'efectivo'),
  ('22222222-2222-2222-2222-222222222209'::uuid, 'wordpress',
   'wp-1006', (now() at time zone 'America/Bogota')::date,
   now() - interval '2 hours 30 minutes', 'pagado', 320000,
   'Ricardo Castillo', 'tarjeta'),
  ('22222222-2222-2222-2222-222222222210'::uuid, 'wordpress',
   'wp-1007', (now() at time zone 'America/Bogota')::date,
   now() - interval '3 hours', 'pagado', 79000,
   'Sandra Gómez', 'pse'),
  ('22222222-2222-2222-2222-222222222211'::uuid, 'csv-upload',
   'csv-2004', (now() at time zone 'America/Bogota')::date,
   now() - interval '3 hours 30 minutes', 'pagado', 210000,
   'Juan David Pineda', 'tarjeta'),
  ('22222222-2222-2222-2222-222222222212'::uuid, 'wordpress',
   'wp-1008', (now() at time zone 'America/Bogota')::date,
   now() - interval '4 hours', 'pagado', 144000,
   'Marcela Rincón', 'tarjeta')
on conflict (canal, external_order_id) do nothing;

-- 3. Sale items -------------------------------------------------------
--    Each sale has 1-3 items. Items where master_sku is set will roll up
--    into v_hoy_top_products; items with external_product_id set but no
--    master_sku represent "ventas sin emparejar" — these don't drive the
--    queue (the queue is product_mappings), but they live in the schema
--    waiting for cascade. For the demo, we want both: top-10 populated +
--    queue populated. The queue is filled in step 4.

insert into public.sale_items
  (id, sale_id, master_sku, external_sku, external_product_id, product_name,
   quantity, unit_price, line_total)
values
  -- sale 1: matched
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222201'::uuid,
   '11111111-1111-1111-1111-111111111101'::uuid, 'CAP-RUB-001',
   'wp-prod-101', 'Tinte para cabello rubio dorado 60ml',
   2, 35000, 70000),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222201'::uuid,
   '11111111-1111-1111-1111-111111111106'::uuid, 'CAP-ACT-ARG',
   'wp-prod-106', 'Aceite capilar argán 100ml',
   1, 19000, 19000),
  -- sale 2: matched
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222202'::uuid,
   '11111111-1111-1111-1111-111111111103'::uuid, 'GLD-PLC-230',
   'wp-prod-103', 'Plancha alisadora cerámica 230°C',
   1, 145000, 145000),
  -- sale 3: matched
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222203'::uuid,
   '11111111-1111-1111-1111-111111111102'::uuid, 'NAT-CRM-050',
   'wp-prod-102', 'Crema hidratante facial 50ml',
   2, 28000, 56000),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222203'::uuid,
   '11111111-1111-1111-1111-111111111105'::uuid, 'NAT-MSK-COL',
   'wp-prod-105', 'Mascarilla anti-edad con colágeno',
   1, 11000, 11000),
  -- sale 4: csv-upload matched
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222204'::uuid,
   '11111111-1111-1111-1111-111111111103'::uuid, null,
   null, 'Plancha alisadora cerámica 230°C',
   1, 145000, 145000),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222204'::uuid,
   '11111111-1111-1111-1111-111111111101'::uuid, null,
   null, 'Tinte para cabello rubio dorado 60ml',
   2, 35000, 70000),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222204'::uuid,
   '11111111-1111-1111-1111-111111111104'::uuid, null,
   null, 'Set de brochas maquillaje x12', 1, 15000, 15000),
  -- sale 5: matched
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222205'::uuid,
   '11111111-1111-1111-1111-111111111104'::uuid, 'BTP-BR-12',
   'wp-prod-104', 'Set de brochas maquillaje x12', 4, 15000, 60000),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222205'::uuid,
   '11111111-1111-1111-1111-111111111102'::uuid, 'NAT-CRM-050',
   'wp-prod-102', 'Crema hidratante facial 50ml', 3, 28000, 84000),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222205'::uuid,
   '11111111-1111-1111-1111-111111111106'::uuid, 'CAP-ACT-ARG',
   'wp-prod-106', 'Aceite capilar argán 100ml', 1, 19000, 19000),
  -- sale 6: csv-upload, no master_sku → "unmatched" line (audit only)
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222206'::uuid,
   null, null,
   'csv-row-501', 'Crema antiarrugas 100ml NaturaSkin Premium',
   1, 50000, 50000),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222206'::uuid,
   '11111111-1111-1111-1111-111111111104'::uuid, 'BTP-BR-12',
   'wp-prod-104', 'Set de brochas maquillaje x12', 3, 15000, 45000),
  -- sale 7
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222207'::uuid,
   '11111111-1111-1111-1111-111111111101'::uuid, 'CAP-RUB-001',
   'wp-prod-101', 'Tinte para cabello rubio dorado 60ml', 3, 35000, 105000),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222207'::uuid,
   '11111111-1111-1111-1111-111111111105'::uuid, 'NAT-MSK-COL',
   'wp-prod-105', 'Mascarilla anti-edad con colágeno', 1, 7000, 7000),
  -- sale 8: csv-upload
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222208'::uuid,
   '11111111-1111-1111-1111-111111111102'::uuid, 'NAT-CRM-050',
   null, 'Crema hidratante facial 50ml', 2, 28000, 56000),
  -- sale 9
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222209'::uuid,
   '11111111-1111-1111-1111-111111111103'::uuid, 'GLD-PLC-230',
   'wp-prod-103', 'Plancha alisadora cerámica 230°C', 2, 145000, 290000),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222209'::uuid,
   '11111111-1111-1111-1111-111111111104'::uuid, 'BTP-BR-12',
   'wp-prod-104', 'Set de brochas maquillaje x12', 2, 15000, 30000),
  -- sale 10
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222210'::uuid,
   '11111111-1111-1111-1111-111111111106'::uuid, 'CAP-ACT-ARG',
   'wp-prod-106', 'Aceite capilar argán 100ml', 4, 19000, 76000),
  -- sale 11: csv-upload, mixed
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222211'::uuid,
   '11111111-1111-1111-1111-111111111103'::uuid, 'GLD-PLC-230',
   null, 'Plancha alisadora cerámica 230°C', 1, 145000, 145000),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222211'::uuid,
   '11111111-1111-1111-1111-111111111101'::uuid, 'CAP-RUB-001',
   null, 'Tinte para cabello rubio dorado 60ml', 2, 35000, 70000),
  -- sale 12
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222212'::uuid,
   '11111111-1111-1111-1111-111111111105'::uuid, 'NAT-MSK-COL',
   'wp-prod-105', 'Mascarilla anti-edad con colágeno', 2, 11000, 22000),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222212'::uuid,
   '11111111-1111-1111-1111-111111111102'::uuid, 'NAT-CRM-050',
   'wp-prod-102', 'Crema hidratante facial 50ml', 2, 28000, 56000),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222212'::uuid,
   '11111111-1111-1111-1111-111111111104'::uuid, 'BTP-BR-12',
   'wp-prod-104', 'Set de brochas maquillaje x12', 4, 15000, 60000)
on conflict do nothing;

-- 4. product_mappings — queue rows for /matching ----------------------
--    Score below 0.78 (queue cutoff). Realistic mid-confidence matches
--    from the cascade waiting on human approval.

insert into public.product_mappings
  (id, master_sku, canal, external_id, external_name, external_sku,
   match_method, score, validado_humano)
values
  ('33333333-3333-3333-3333-333333333301'::uuid,
   '11111111-1111-1111-1111-111111111101'::uuid, 'wordpress',
   'wp-prod-901',
   'Tinte rubio platino 60ml Capilatis edición especial', 'CAP-PLAT-60',
   'embeddings_mid', 0.74, false),
  ('33333333-3333-3333-3333-333333333302'::uuid,
   '11111111-1111-1111-1111-111111111102'::uuid, 'wordpress',
   'wp-prod-902',
   'Crema hidratante facial NaturaSkin x50ml', 'NS-CRMFCL-50',
   'normalized_name_exact', 0.71, false),
  ('33333333-3333-3333-3333-333333333303'::uuid,
   '11111111-1111-1111-1111-111111111104'::uuid, 'csv-upload',
   'csv-row-501', 'Crema antiarrugas 100ml NaturaSkin Premium', null,
   'llm_arbiter_match', 0.66, false),
  ('33333333-3333-3333-3333-333333333304'::uuid,
   '11111111-1111-1111-1111-111111111103'::uuid, 'wordpress',
   'wp-prod-903',
   'Plancha alisadora 230 grados profesional', 'PLC-PROF-230',
   'embeddings_mid', 0.77, false)
on conflict (canal, external_id) do nothing;

-- Done. Reload /hoy and /matching in the dashboard.
