# Amendment 001 — CSV Upload como fuente de datos de primera clase

**Fecha:** 2026-05-13
**Estado:** LOCKED
**Tipo:** PRD amendment
**Documento base:** `docs/PRD.md`
**Decisor:** cliente/dev (Nicolás)

---

## Cambio respecto al PRD original

El PRD base menciona ingesta CSV solo como **Plan B** para Dropi cuando el scraper falla (sección 3.4). Este amendment **eleva CSV upload a fuente de datos de primera clase** con las siguientes características:

1. **No es contingencia, es funcionalidad permanente.**
2. **Se mantiene histórico**: cada CSV subido se conserva con su payload original en `raw_csv_uploads` (paralelo a `raw_orders` / `raw_products`).
3. **Se analiza automáticamente**: al subir, el archivo pasa por el pipeline de matching y se reflejan ventas/inventario en los marts.
4. **Es agnóstico al canal**: cualquier canal puede aportar CSVs (no solo Dropi). Casos previstos:
   - Histórico inicial de cada canal antes de habilitar conectores en vivo
   - Canales sin API (proveedores futuros, ferias, ventas mayoristas)
   - Backfill manual cuando un conector falla
   - Reconciliación contable mensual

---

## Implicaciones en arquitectura

### Esquema (nuevas tablas en capa RAW)

```
raw_csv_uploads
  - upload_id              (PK, UUID)
  - canal_declarado        (wordpress / mercadolibre / dropi / pos / whatsapp / otro)
  - tipo                   (orders / products / inventory / mixto)
  - filename
  - bytes
  - row_count
  - uploaded_by            (FK user)
  - uploaded_at
  - storage_path           (Supabase Storage)
  - mapping_profile_id     (FK a perfil de columnas, ver abajo)
  - status                 (uploaded / validating / processed / failed)
  - error_log_json

raw_csv_rows
  - upload_id (FK)
  - row_number
  - payload_json           (la fila tal cual, sin transformar)
  - processed              (bool)
  - target_table           (raw_orders / raw_products / ...)

csv_mapping_profiles
  - id (PK)
  - nombre                 (ej: "Dropi pedidos v2", "ML productos export")
  - canal
  - tipo
  - column_map_json        ({"Fecha": "fecha", "SKU vendedor": "external_sku", ...})
  - reglas_json            (transformaciones, defaults, validaciones)
  - creado_por
  - version
```

### Conector CSV genérico

```typescript
class CSVConnector implements ChannelConnector {
  name = "csv-upload";
  type = "manual";
  // Recibe el upload + mapping profile, emite NormalizedOrder/Product
  async ingestUpload(uploadId: string): Promise<IngestResult>;
}
```

### UI en el dashboard (vista "Operación")

- Botón "Subir CSV" → wizard de 3 pasos:
  1. Elegir canal + tipo + (opcional) perfil de mapping existente
  2. Vista previa con auto-detección de columnas; usuario confirma/ajusta
  3. Validación + dry-run + confirmación
- Tabla histórica de uploads con status, conteo, link a raw, opción de reprocesar

---

## Impacto en fases

- **Fase 0 (Discovery):** los catálogos exportados por canal ya son CSVs → se procesan con este mecanismo desde el inicio. La fase produce los **primeros mapping profiles**.
- **Fase 1 (Foundation):** el esquema arriba se crea junto al schema base. El `CSVConnector` y el endpoint de upload son entregable de Fase 1, no de fases posteriores.
- **Fase 2 (Walking skeleton WordPress):** el CSV connector se usa para el backfill histórico inicial de WordPress antes de activar el sync en vivo.
- **Fase 4 (Dropi):** Dropi usa el mismo `CSVConnector` como fallback automático cuando el scraper falla, ya sin código adicional.

---

## Por qué importa

1. **Desbloquea Fase 0**: sin CSV ingestion no podemos cargar los exports históricos del cliente para hacer el matching exploratorio.
2. **Reduce riesgo**: si MercadoLibre o Dropi rompen su API, el negocio sigue cargando ventas manualmente vía CSV. Cero downtime de datos.
3. **Permite backfill ilimitado**: histórico de años previos se carga sin tocar conectores.
4. **Histórico inmutable**: el payload crudo queda en Storage + raw, así que se pueden reprocesar uploads con mappings corregidos sin perder datos.
