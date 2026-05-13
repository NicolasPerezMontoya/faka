-- packages/db/supabase/seed.sql
-- Seeded on every `supabase db reset` (run after migrations).
-- All inserts are idempotent (`on conflict do nothing`) so re-runs are safe.
--
-- Phase 1 / Plan 1.1.7.
--
-- Pre-seed the 4 mapping profiles from scripts/discovery/profiles/*.json
-- (PATTERNS §5.3 — the JSON shape IS the production contract; do NOT
-- redesign). Each gets version=1 and is_active=true. WhatsApp orders
-- placeholder is included even without a discovery JSON yet (is_active
-- false until F3 form goes live).

------------------------------------------------------------------------------
-- WordPress products profile (verbatim from scripts/discovery/profiles/wordpress-products.json)
------------------------------------------------------------------------------

insert into public.csv_mapping_profiles
  (nombre, canal, tipo, column_map_json, reglas_json, version, is_active)
values (
  'WordPress · Export productos · v1',
  'wordpress',
  'products',
  $${
    "external_id": "ID",
    "sku": "SKU",
    "name": "Name",
    "description": "Short description",
    "category": "Categories",
    "brand": "Attribute 1 value(s)",
    "price": "Regular price",
    "barcode": "Attribute 2 value(s)",
    "supplier_code": "Attribute 3 value(s)",
    "image_url": "Images",
    "status": "Visibility in catalog"
  }$$::jsonb,
  '{"delimiter": ","}'::jsonb,
  1,
  true
)
on conflict (canal, tipo, nombre, version) do nothing;

------------------------------------------------------------------------------
-- Mercado Libre products profile
------------------------------------------------------------------------------

insert into public.csv_mapping_profiles
  (nombre, canal, tipo, column_map_json, reglas_json, version, is_active)
values (
  'Mercado Libre · Export publicaciones · v1',
  'mercadolibre',
  'products',
  $${
    "external_id": "Item ID",
    "sku": "SKU",
    "name": "Título",
    "category": "Categoría",
    "brand": "Marca",
    "price": "Precio",
    "barcode": "GTIN",
    "image_url": "Imagen",
    "status": "Estado"
  }$$::jsonb,
  '{"delimiter": ",", "encoding_hint": "utf-8 — re-save from windows-1252 if needed"}'::jsonb,
  1,
  true
)
on conflict (canal, tipo, nombre, version) do nothing;

------------------------------------------------------------------------------
-- Dropi products profile (panel proveedor)
------------------------------------------------------------------------------

insert into public.csv_mapping_profiles
  (nombre, canal, tipo, column_map_json, reglas_json, version, is_active)
values (
  'Dropi · Export productos proveedor · v1',
  'dropi',
  'products',
  $${
    "external_id": "ID producto",
    "sku": "SKU proveedor",
    "name": "Nombre",
    "category": "Categoría",
    "cost": "Precio proveedor",
    "price": "Precio público Dropi",
    "image_url": "Imagen",
    "status": "Estado producto"
  }$$::jsonb,
  '{"delimiter": ","}'::jsonb,
  1,
  true
)
on conflict (canal, tipo, nombre, version) do nothing;

------------------------------------------------------------------------------
-- POS products profile (custom POS export)
------------------------------------------------------------------------------

insert into public.csv_mapping_profiles
  (nombre, canal, tipo, column_map_json, reglas_json, version, is_active)
values (
  'POS · Export inventario · v1',
  'pos',
  'products',
  $${
    "external_id": "id_producto",
    "sku": "sku",
    "name": "nombre_producto",
    "category": "categoría",
    "price": "precio_venta",
    "cost": "precio_costo",
    "barcode": "código_barras",
    "supplier_code": "código_proveedor",
    "status": "activo"
  }$$::jsonb,
  '{"delimiter": ","}'::jsonb,
  1,
  true
)
on conflict (canal, tipo, nombre, version) do nothing;

------------------------------------------------------------------------------
-- WhatsApp orders placeholder (is_active=false until F3 form ships)
------------------------------------------------------------------------------

insert into public.csv_mapping_profiles
  (nombre, canal, tipo, column_map_json, reglas_json, version, is_active)
values (
  'WhatsApp · Pedidos manuales · v1 (placeholder)',
  'whatsapp',
  'orders',
  '{}'::jsonb,
  '{"_note": "shape defined in F3 when the form ships"}'::jsonb,
  1,
  false
)
on conflict (canal, tipo, nombre, version) do nothing;
