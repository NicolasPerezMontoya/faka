# Plantillas CSV para Discovery — Fase 0

Estas plantillas definen el formato mínimo que necesitamos que el cliente entregue para cargar el catálogo de cada canal y correr el matching exploratorio.

## Reglas generales

- **Encoding:** UTF-8 (sin BOM). Excel a veces guarda en CP-1252; convertir antes de subir.
- **Separador:** coma (`,`). Si el contenido tiene comas, envolver en comillas dobles `"..."`.
- **Fechas:** ISO-8601 `YYYY-MM-DD` (ej. `2026-05-13`). Sin formato local.
- **Decimales:** punto (`.`), no coma. Ejemplo: `49900.50`.
- **Moneda:** COP (pesos colombianos). Sin símbolo `$`, solo el número.
- **Vacíos:** dejar la celda vacía (no escribir `null` o `N/A`).
- **Nombre de archivo:** `<canal>-<tipo>-<YYYY-MM-DD>.csv`
  - Ejemplos: `wordpress-products-2026-05-13.csv`, `mercadolibre-orders-2026-05-13.csv`

## Tipos de export por canal

| Canal         | products       | orders                  | inventory    | notas                                                                            |
| ------------- | -------------- | ----------------------- | ------------ | -------------------------------------------------------------------------------- |
| WordPress     | ✅ obligatorio | ⚠️ recomendado          | opcional     | si es WooCommerce, plugin Product Export hace ambos                              |
| Mercado Libre | ✅ obligatorio | ⚠️ recomendado          | opcional     | export desde Mi Cuenta → Publicaciones                                           |
| Dropi         | ✅ obligatorio | opcional                | opcional     | desde el panel de proveedor → Productos / Mis pedidos                            |
| POS           | ✅ obligatorio | ⚠️ recomendado          | opcional     | si no se puede exportar, pedirle al programador del POS un dump SQL              |
| WhatsApp      | ➖ no aplica   | ✅ obligatorio (manual) | ➖ no aplica | exportar las ventas de los últimos 30 días desde donde sea que las registren hoy |

## Próximo paso

Por cada CSV recibido, el dev:

1. Lo deposita en `scratch/raw-csvs/<canal>/<archivo>.csv` (ignorado por git).
2. Define un `mapping_profile` editando `scripts/discovery/profiles/<canal>-<tipo>.json` que mapea columnas del export a campos canónicos.
3. Corre `npm run discovery:match` para obtener el reporte de matching.

Ver plantillas específicas por canal:

- [`wordpress.md`](./wordpress.md)
- [`mercadolibre.md`](./mercadolibre.md)
- [`dropi.md`](./dropi.md)
- [`pos.md`](./pos.md)
- [`whatsapp.md`](./whatsapp.md)
