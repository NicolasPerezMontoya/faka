# Plantilla CSV — Mercado Libre Colombia

## Cómo exportar

**Productos (publicaciones):**
1. Mercado Libre → Mi cuenta → Publicaciones.
2. Botón "Descargar" (esquina superior derecha) → "Excel".
3. Convertir a CSV (Guardar como → CSV UTF-8).

**Pedidos:**
1. Mercado Libre → Mi cuenta → Ventas.
2. Filtros: rango de fechas (recomendado: último mes completo).
3. Descargar Excel → convertir a CSV.

> Nota: ML exporta con encoding Windows-1252. Abrir en LibreOffice/Google Sheets y guardar como UTF-8 antes de enviar.

---

## `mercadolibre-products-YYYY-MM-DD.csv` — columnas

| Columna canónica | Origen ML | Tipo | Requerido | Ejemplo |
|------------------|-----------|------|-----------|---------|
| `external_id` | `Item ID` (MLM…) | string | ✅ | `MCO123456789` |
| `sku` | `SKU` (custom) | string | ⚠️ si lo cargaron | `PLN-2026-RJ` |
| `name` | `Título` | string | ✅ | `Plancha De Cabello Pro 2026 Color Rojo Titanio` |
| `category` | `Categoría` | string (path con `>`) | opcional | `Belleza y Cuidado Personal > Cuidado del Cabello > Planchas` |
| `brand` | atributo `BRAND` | string | opcional | `Remington` |
| `price` | `Precio` | decimal | ✅ | `89900` |
| `barcode` | atributo `GTIN` o `EAN` | string | ⚠️ si existe | `7701234567890` |
| `model` | atributo `MODEL` | string | opcional | `S-9500` |
| `image_url` | `Imagen` (primera) | url | opcional | `https://http2.mlstatic.com/...` |
| `stock` | `Stock disponible` | int | opcional | `5` |
| `status` | `Estado` | enum | ✅ | `active` / `paused` / `closed` |
| `listing_type` | `Tipo de publicación` | string | opcional | `gold_special` |
| `parent_item_id` | si es variación de otra | string | ⚠️ si variante | `MCO123456789` |
| `variation_attributes_json` | combinación talla/color | json | ⚠️ si variante | `{"color":"rojo","talla":"M"}` |

## `mercadolibre-orders-YYYY-MM-DD.csv` — columnas

| Columna canónica | Origen ML | Tipo | Requerido | Ejemplo |
|------------------|-----------|------|-----------|---------|
| `external_order_id` | `# de venta` | string | ✅ | `2000123456789` |
| `order_date` | `Fecha de venta` | date ISO | ✅ | `2026-05-10` |
| `order_time` | `Hora de venta` | time | opcional | `09:14:22` |
| `customer_id` | `Comprador` (nickname) | string | opcional | `JUAN.PEREZ123` |
| `customer_name` | `Nombre comprador` | string | opcional | `Juan Pérez` |
| `customer_phone` | `Teléfono` | string | opcional | `+573001234567` |
| `status` | `Estado venta` | enum | ✅ | `paid` / `cancelled` / `refunded` |
| `shipping_method` | `Forma de envío` | string | opcional | `Mercado Envíos` |
| `subtotal` | `Subtotal` | decimal | ✅ | `89900` |
| `shipping_cost` | `Costo envío` | decimal | opcional | `0` (free shipping ML) |
| `commission` | `Comisión ML` | decimal | opcional | `13485` |
| `total` | `Total venta` | decimal | ✅ | `89900` |
| `currency` | siempre `COP` | string | ✅ | `COP` |

## `mercadolibre-order-items-YYYY-MM-DD.csv` — columnas

| Columna canónica | Origen ML | Tipo | Requerido | Ejemplo |
|------------------|-----------|------|-----------|---------|
| `external_order_id` | `# de venta` | string | ✅ | `2000123456789` |
| `external_product_id` | `Item ID` | string | ✅ | `MCO123456789` |
| `external_sku` | `SKU` | string | ⚠️ si existe | `PLN-2026-RJ` |
| `product_name` | `Título publicación` | string | ✅ | `Plancha De Cabello Pro 2026...` |
| `quantity` | `Cantidad` | int | ✅ | `1` |
| `unit_price` | `Precio unitario` | decimal | ✅ | `89900` |
| `line_total` | `Total línea` | decimal | ✅ | `89900` |

---

## Notas

- `external_id` en ML siempre empieza con `MCO` (Colombia). Si ves `MLM` (México) o `MLA` (Argentina) en el CSV, hay un problema de configuración.
- `barcode` en ML se carga como atributo `GTIN`. Es opcional para el vendedor pero **muy útil para nosotros** — si el cliente puede cargarlo en sus publicaciones, hagámoslo antes del cutover.
- Los títulos en ML están escritos en mayúsculas iniciales por palabra ("Plancha De Cabello"). El normalizador lo maneja, pero conviene saberlo.
