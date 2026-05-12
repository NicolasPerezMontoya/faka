# Plantilla CSV — WordPress / WooCommerce

## Cómo exportar

**Si es WooCommerce:**
1. Plugin sugerido: "Product Import Export for WooCommerce" (versión free funciona).
2. Productos → Exportar → seleccionar todos los campos relevantes → CSV.
3. Por separado: Pedidos (Orders) → Exportar con plugin "Order Export and Order Import for WooCommerce".

**Si es WordPress custom (no WooCommerce):**
- Necesitamos un dump de la tabla de productos del CMS. El dev coordina con quien construyó el sitio.

---

## `wordpress-products-YYYY-MM-DD.csv` — columnas

| Columna canónica | Origen WooCommerce | Tipo | Requerido | Ejemplo |
|------------------|--------------------|------|-----------|---------|
| `external_id` | `ID` (post ID) | int | ✅ | `4521` |
| `sku` | `SKU` | string | ⚠️ si existe | `PLN-2026-RJ` |
| `name` | `Name` | string | ✅ | `Plancha de cabello Pro 2026 Rojo` |
| `description` | `Short description` o `Description` | string | opcional | `Plancha con placas de titanio...` |
| `category` | `Categories` | string (separadas por `>`) | opcional | `Belleza > Cabello > Planchas` |
| `brand` | atributo custom `pa_brand` o campo brand | string | opcional | `Remington` |
| `price` | `Regular price` | decimal | ✅ | `89900` |
| `sale_price` | `Sale price` | decimal | opcional | `74900` |
| `barcode` | atributo custom o campo EAN | string | ⚠️ si existe | `7701234567890` |
| `supplier_code` | atributo custom `pa_supplier_code` o similar | string | ⚠️ si existe | `IMP-A-145` |
| `image_url` | `Images` (primera URL) | url | opcional | `https://faka.co/wp-content/uploads/2026/01/plancha-roja.jpg` |
| `stock` | `Stock` | int | opcional | `12` |
| `status` | `Visibility` | enum (`publish`/`draft`/`private`) | ✅ | `publish` |
| `parent_sku` | `Parent` (para variantes) | string | ⚠️ si es variante | `PLN-2026` |
| `attributes_json` | atributos seriados (talla, color) | json string | ⚠️ si variantes | `{"color":"rojo"}` |

## `wordpress-orders-YYYY-MM-DD.csv` — columnas

| Columna canónica | Origen WooCommerce | Tipo | Requerido | Ejemplo |
|------------------|--------------------|------|-----------|---------|
| `external_order_id` | `Order ID` | int | ✅ | `18723` |
| `order_date` | `Order date` | date ISO | ✅ | `2026-05-12` |
| `order_time` | `Order time` | time | opcional | `14:32:01` |
| `customer_email` | `Billing email` | string | opcional | `cliente@ejemplo.co` |
| `customer_phone` | `Billing phone` | string | opcional | `+573001234567` |
| `status` | `Status` | enum | ✅ | `completed` / `pending` / `cancelled` / `refunded` |
| `subtotal` | `Cart total` | decimal | ✅ | `89900` |
| `discount` | `Cart discount` | decimal | opcional | `5000` |
| `shipping_cost` | `Shipping total` | decimal | opcional | `12000` |
| `total` | `Order total` | decimal | ✅ | `96900` |
| `currency` | `Currency` | string | ✅ | `COP` |
| `payment_method` | `Payment method` | string | opcional | `wompi` |

## `wordpress-order-items-YYYY-MM-DD.csv` — columnas (line items)

| Columna canónica | Origen | Tipo | Requerido | Ejemplo |
|------------------|--------|------|-----------|---------|
| `external_order_id` | join contra orders | int | ✅ | `18723` |
| `external_sku` | `Item SKU` | string | ✅ | `PLN-2026-RJ` |
| `external_product_id` | `Item product ID` | int | ✅ | `4521` |
| `product_name` | `Item name` | string | ✅ | `Plancha de cabello Pro 2026 Rojo` |
| `quantity` | `Item quantity` | int | ✅ | `2` |
| `unit_price` | `Item price` | decimal | ✅ | `74900` |
| `line_discount` | `Item discount` | decimal | opcional | `0` |
| `line_total` | `Item total` | decimal | ✅ | `149800` |

---

## Notas

- Si el plugin de export sólo permite un CSV combinado (products + orders), pídele al cliente que lo separe o que envíe ese formato y nosotros lo procesamos.
- Si el sitio NO es WooCommerce, este formato sigue siendo el target — pero el cliente nos envía el dump y nosotros mapeamos.
- Las columnas `barcode` y `supplier_code` son las más importantes para matching automático: si el cliente las tiene aunque sea parcial, agréguenlas aunque otras estén vacías.
