# Plantilla CSV — POS físico

## Cómo exportar

**Depende del software del POS** (a confirmar en cuestionario de discovery):

- **Si es POS comercial** (Loyverse, Square, Alegra POS, Siigo, etc.): casi todos tienen "Reportes → Exportar CSV/Excel". Pedir al cliente el export del último mes.
- **Si es POS custom (programador del cliente):**
  - **Opción A:** pedirle al programador un dump SQL de las tablas relevantes (`productos`, `ventas`, `venta_items`).
  - **Opción B:** que el programador exporte CSVs en el formato de esta plantilla.
  - **Opción C (lo ideal a futuro):** webhooks en tiempo real (Fase 3 — no para discovery).

Dos POS físicos = dos exports separados (uno por punto). Identificar cada archivo con `pos1-` o `pos2-`.

---

## `pos1-products-YYYY-MM-DD.csv` — columnas

| Columna canónica | Origen típico                    | Tipo       | Requerido    | Ejemplo                 |
| ---------------- | -------------------------------- | ---------- | ------------ | ----------------------- |
| `external_id`    | `id_producto` o `código_interno` | string/int | ✅           | `LOC-4521`              |
| `sku`            | `sku`                            | string     | ⚠️ si existe | `PLN-2026-RJ`           |
| `name`           | `nombre_producto`                | string     | ✅           | `Plancha Pro 2026 Rojo` |
| `category`       | `categoría`                      | string     | opcional     | `Belleza`               |
| `price`          | `precio_venta`                   | decimal    | ✅           | `89900`                 |
| `cost`           | `precio_costo`                   | decimal    | ⚠️ muy útil  | `45000`                 |
| `barcode`        | `código_barras` o EAN            | string     | ⚠️ si existe | `7701234567890`         |
| `supplier_code`  | `código_proveedor`               | string     | ⚠️ si existe | `IMP-A-145`             |
| `stock`          | `stock_actual`                   | int        | ✅           | `8`                     |
| `status`         | `activo`                         | bool/enum  | ✅           | `activo` / `inactivo`   |

## `pos1-orders-YYYY-MM-DD.csv` — columnas

| Columna canónica    | Origen típico            | Tipo     | Requerido | Ejemplo                                                                       |
| ------------------- | ------------------------ | -------- | --------- | ----------------------------------------------------------------------------- |
| `external_order_id` | `# factura` o `id_venta` | string   | ✅        | `F-001-23415`                                                                 |
| `pos_id`            | identificador del punto  | string   | ✅        | `pos1`                                                                        |
| `order_date`        | `fecha`                  | date ISO | ✅        | `2026-05-12`                                                                  |
| `order_time`        | `hora`                   | time     | ✅        | `15:42:00`                                                                    |
| `cashier_id`        | `cajero` o `usuario`     | string   | opcional  | `vendedor-3`                                                                  |
| `customer_doc`      | `cédula_cliente`         | string   | opcional  | `1023456789`                                                                  |
| `customer_name`     | `nombre_cliente`         | string   | opcional  | `Juan Pérez`                                                                  |
| `payment_method`    | `forma_pago`             | enum     | ✅        | `efectivo` / `tarjeta_credito` / `tarjeta_debito` / `nequi` / `transferencia` |
| `subtotal`          | `subtotal`               | decimal  | ✅        | `89900`                                                                       |
| `discount`          | `descuento`              | decimal  | opcional  | `5000`                                                                        |
| `tax`               | `iva`                    | decimal  | opcional  | `0`                                                                           |
| `total`             | `total`                  | decimal  | ✅        | `84900`                                                                       |
| `currency`          | `COP`                    | string   | ✅        | `COP`                                                                         |

## `pos1-order-items-YYYY-MM-DD.csv` — columnas

| Columna canónica      | Origen típico     | Tipo       | Requerido               | Ejemplo                 |
| --------------------- | ----------------- | ---------- | ----------------------- | ----------------------- |
| `external_order_id`   | `# factura`       | string     | ✅                      | `F-001-23415`           |
| `external_product_id` | `id_producto`     | string/int | ✅                      | `LOC-4521`              |
| `external_sku`        | `sku`             | string     | ⚠️ si existe            | `PLN-2026-RJ`           |
| `product_name`        | `nombre_producto` | string     | ✅                      | `Plancha Pro 2026 Rojo` |
| `quantity`            | `cantidad`        | int        | ✅                      | `1`                     |
| `unit_price`          | `precio_unitario` | decimal    | ✅                      | `89900`                 |
| `unit_cost`           | `costo_unitario`  | decimal    | ⚠️ muy útil para margen | `45000`                 |
| `line_total`          | `total_línea`     | decimal    | ✅                      | `89900`                 |

---

## Notas

- **El campo `cost` / `unit_cost` es oro.** El POS suele tener costo unitario actualizado al momento de la venta. Sin esto, no podemos calcular margen real en el dashboard.
- Dos puntos de venta = dos archivos. El campo `pos_id` debe estar consistente con la decisión de identificación que el cliente confirme en el cuestionario (Bloque D.4).
- Si el POS solo tiene un sistema agregado (no separa por punto), el cliente debe agregar el campo `pos_id` manualmente al export.
- Cualquier inconsistencia entre `stock` del POS y `stock` reportado en WP/ML probablemente indica un problema operativo del negocio, no del dashboard. Lo marcamos pero no lo "corregimos" automáticamente.
