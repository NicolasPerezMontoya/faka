# Plantilla CSV — Dropi (como proveedor)

## Cómo exportar

**Dropi no tiene API pública útil para proveedores**. Las dos rutas:

**Ruta A — Export desde el panel (manual, recomendada para Fase 0):**

1. Acceder al panel de proveedor en Dropi.
2. Menú "Productos" o "Mi catálogo" → botón de descarga (suele ser un ícono de Excel).
3. Para pedidos: "Mis pedidos" o "Órdenes" → filtrar rango → descargar.
4. Si el panel exporta XLSX, convertir a CSV UTF-8.

**Ruta B — Si no hay opción de export:**

- Tomar capturas de pantalla de la lista de productos paginada.
- El dev escribe un script de scraping Playwright que reconstruye el CSV. Más lento, queda para Fase 4 si es necesario.

---

## `dropi-products-YYYY-MM-DD.csv` — columnas

| Columna canónica | Origen Dropi                                           | Tipo       | Requerido      | Ejemplo                          |
| ---------------- | ------------------------------------------------------ | ---------- | -------------- | -------------------------------- |
| `external_id`    | `ID producto`                                          | string/int | ✅             | `78421`                          |
| `sku`            | `SKU proveedor`                                        | string     | ⚠️ si existe   | `PLN-2026-RJ`                    |
| `name`           | `Nombre`                                               | string     | ✅             | `Plancha Pro 2026 Rojo`          |
| `description`    | `Descripción`                                          | string     | opcional       |                                  |
| `category`       | `Categoría Dropi`                                      | string     | opcional       | `Belleza`                        |
| `cost_supplier`  | `Precio proveedor` (lo que ustedes le cobran a Dropi)  | decimal    | ✅             | `45000`                          |
| `price_dropi`    | `Precio público Dropi` (lo que muestra al dropshipper) | decimal    | opcional       | `89900`                          |
| `barcode`        | si existe                                              | string     | ⚠️ si existe   | `7701234567890`                  |
| `image_url`      | imagen principal                                       | url        | opcional       |                                  |
| `stock`          | `Stock disponible`                                     | int        | ⚠️ recomendado | `25`                             |
| `status`         | `Estado producto`                                      | enum       | ✅             | `activo` / `agotado` / `pausado` |

## `dropi-orders-YYYY-MM-DD.csv` — columnas

| Columna canónica    | Origen Dropi                     | Tipo     | Requerido | Ejemplo                                             |
| ------------------- | -------------------------------- | -------- | --------- | --------------------------------------------------- |
| `external_order_id` | `# orden`                        | string   | ✅        | `DRP-9876543`                                       |
| `order_date`        | `Fecha pedido`                   | date ISO | ✅        | `2026-05-11`                                        |
| `dropshipper_id`    | `ID dropshipper` (el que vendió) | string   | opcional  | `D-1234`                                            |
| `dropshipper_name`  | `Dropshipper`                    | string   | opcional  | `Carla M.`                                          |
| `customer_city`     | `Ciudad destino`                 | string   | opcional  | `Medellín`                                          |
| `customer_dept`     | `Departamento`                   | string   | opcional  | `Antioquia`                                         |
| `status`            | `Estado`                         | enum     | ✅        | `confirmado` / `en_ruta` / `entregado` / `devuelto` |
| `subtotal`          | `Subtotal`                       | decimal  | ✅        | `45000`                                             |
| `total`             | `Total`                          | decimal  | ✅        | `45000`                                             |
| `currency`          | `COP`                            | string   | ✅        | `COP`                                               |

## `dropi-order-items-YYYY-MM-DD.csv` — columnas

| Columna canónica      | Origen Dropi      | Tipo    | Requerido    | Ejemplo                 |
| --------------------- | ----------------- | ------- | ------------ | ----------------------- |
| `external_order_id`   | `# orden`         | string  | ✅           | `DRP-9876543`           |
| `external_product_id` | `ID producto`     | string  | ✅           | `78421`                 |
| `external_sku`        | `SKU`             | string  | ⚠️ si existe | `PLN-2026-RJ`           |
| `product_name`        | `Nombre producto` | string  | ✅           | `Plancha Pro 2026 Rojo` |
| `quantity`            | `Cantidad`        | int     | ✅           | `1`                     |
| `unit_price`          | `Precio`          | decimal | ✅           | `45000`                 |
| `line_total`          | total             | decimal | ✅           | `45000`                 |

---

## Notas

- Dropi tiene una flag "fragilidad": pueden cambiar el panel sin avisar y romper el scraper. **El CSV manual es la fuente de verdad** durante Fase 0 y como Plan B permanente para Fase 4 (vía `CSVConnector`, LOCKED en ADR-001).
- `cost_supplier` es el precio que el cliente cobra a Dropi, no el precio público. Sin esta cifra no podemos calcular margen real del canal Dropi.
- `dropshipper_id` permite analizar quiénes son los mejores dropshippers (si están conectados a sus tasas de devolución, podemos detectar abusos).
