# Dashboard Omnicanal de Ventas + Capa de IA
## Documento de Arquitectura y Plan de Implementación

---

## 1. Contexto y supuestos

**Cliente:** vende telenovedades (televentas) en Colombia.
**Canales actuales:** WordPress, Mercado Libre Colombia, Dropi (como proveedor), 2 puntos de venta físicos con POS propio, WhatsApp Business.
**Canal próximo:** Falabella Marketplace Colombia (no prioritario).
**Volumen:** ~5.000 transacciones/mes consolidadas.
**Usuarios:** 3 (tú como desarrollador, cliente, esposa del cliente).
**Presupuesto:** $150 USD/mes en infraestructura y servicios.
**Catálogo:** miles de SKUs con variantes, sin normalización entre canales, sin identificadores comunes confirmados.
**IA:** Kimi K2 candidato, pero abierto a alternativas; modo de uso = sugerencias autónomas (mañana y tarde) + chat bajo demanda.

---

## 2. Los dos retos del proyecto

Este proyecto tiene dos retos paralelos que conviene separar mentalmente:

**Reto técnico:** construir el orquestador, la base de datos unificada, el dashboard y la capa de IA. Esto es relativamente determinístico — sabemos cómo se hace.

**Reto de calidad de datos:** sin un catálogo maestro confiable, todas las analíticas son ruido. Si "Plancha X" se llama distinto en cada canal y no tiene SKU común, no podemos decir cuál es el producto hot ni predecir nada. **Este es el reto más grande del proyecto y donde la IA aporta más valor desde el día uno**, no como analítica, sino como motor de matching.

Por eso el plan tiene una **Fase 0** dedicada a normalización, y la IA aparece antes de lo habitual en el roadmap.

---

## 3. Arquitectura propuesta

### 3.1 Vista de alto nivel

```
┌──────────────────────────────────────────────────────────────────┐
│                       FUENTES (Conectores)                        │
│  WordPress │ Mercado Libre │ Dropi │ POS propio │ WhatsApp │ ... │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                ┌────────────▼─────────────┐
                │   ORQUESTADOR DE INGESTA │
                │   (Node/TS en Railway)    │
                │  - Scheduler              │
                │  - Conectores modulares   │
                │  - Normalizador           │
                │  - Cola de eventos        │
                └────────────┬──────────────┘
                             │
                ┌────────────▼──────────────┐
                │   SUPABASE (Postgres)     │
                │  - Raw layer              │
                │  - Staging                │
                │  - Master catalog         │
                │  - Marts (vistas)         │
                │  - Insights store         │
                └─────┬──────────────┬──────┘
                      │              │
        ┌─────────────▼───┐    ┌─────▼─────────────┐
        │  DASHBOARD      │    │  CAPA DE IA       │
        │  Next.js/Vercel │    │  - Jobs scheduled │
        │  - Lectura      │    │  - Chat RAG       │
        │  - Roles RLS    │    │  - Matching IA    │
        └─────────────────┘    └───────────────────┘
```

### 3.2 Stack recomendado

| Capa | Tecnología | Costo/mes | Por qué |
|------|------------|-----------|---------|
| Base de datos | Supabase (Postgres + Auth + Storage + Realtime) | $0 free → $25 Pro | Maneja 5K transacciones sin problema; RLS para permisos; auth incluida |
| Orquestador | Node.js + TypeScript en Railway | $5–10 | Cron jobs, workers, fácil deploy, buen DX |
| Dashboard | Next.js 14 (App Router) en Vercel | $0 | Free tier sobra; conecta directo a Supabase |
| IA | Kimi K2 vía API (alternativa: Claude Haiku/Sonnet, GPT-4o-mini) | $20–50 | Pago por uso; ~$0.50/día con uso moderado |
| WhatsApp | Mini-app interna para registro manual (Fase 1) | $0 | Opción B que elegiste; no requiere WhatsApp Business API |
| Monitoring | Better Stack o Axiom (free tier) | $0 | Logs y uptime |
| **Total estimado** | | **$50–85/mes** | Te queda margen de ~$65 |

### 3.3 Modelo de datos (esquema lógico)

Tres capas conceptuales en el mismo Postgres:

**Capa RAW** — guarda lo que cada canal manda, sin transformar. Si Mercado Libre cambia su API, no perdemos histórico.

```
raw_orders          (canal, payload_json, fetched_at)
raw_products        (canal, payload_json, fetched_at)
raw_events          (canal, tipo_evento, payload_json, ocurrido_at)
```

**Capa MASTER** — el catálogo unificado y limpio.

```
master_products
  - master_sku            (PK, generado por nosotros)
  - nombre_canonico
  - categoria
  - marca
  - imagen_principal
  - costo_promedio
  - precio_sugerido
  - estado                (activo / descontinuado / nuevo)
  - confidence_score      (qué tan seguros estamos del matching)

product_mappings
  - master_sku            (FK)
  - canal                 (wordpress / mercadolibre / dropi / pos / whatsapp / falabella)
  - external_id           (SKU o ID en ese canal)
  - external_name         (cómo se llama allá)
  - match_method          (manual / ia_imagen / ia_texto / barcode / regla)
  - validado_humano       (bool)

product_variants
  - master_variant_sku
  - master_sku            (FK)
  - atributos_json        ({"talla":"M","color":"rojo"})
```

**Capa FACTS** — los hechos de venta normalizados.

```
sales
  - sale_id
  - canal
  - external_order_id
  - fecha
  - hora
  - cliente_externo_id    (si hay)
  - subtotal, descuento, total, costo_envio
  - moneda
  - estado                (pagado / pendiente / cancelado / devuelto)
  - punto_venta_id        (para POS físicos)

sale_items
  - sale_id (FK)
  - master_sku (FK)       (puede ser NULL si no se ha hecho match)
  - external_sku
  - cantidad
  - precio_unitario
  - descuento
  - costo_unitario_estimado

inventory_snapshots
  - master_sku
  - canal
  - cantidad
  - capturado_at
```

**Capa MARTS** — vistas materializadas para el dashboard.

```
mart_daily_sales              (fecha, canal, total, num_ordenes, ticket_promedio)
mart_product_velocity         (master_sku, ventana, unidades, tendencia)
mart_top_products_by_window   (ventana, ranking, master_sku, score)
mart_channel_performance      (canal, mes, ingresos, margen_est, growth)
mart_dead_stock               (master_sku, dias_sin_venta, stock_actual)
mart_promotion_candidates     (master_sku, razon, score, sugerencia)
```

**Capa INSIGHTS** — lo que la IA genera.

```
ai_insights
  - id
  - generado_at
  - tipo                  (alerta / oportunidad / anomalia / resumen)
  - severidad
  - titulo
  - cuerpo_markdown
  - master_skus_afectados (array)
  - canal_afectado
  - accion_sugerida
  - revisado_por_usuario
  - feedback              (util / no_util / accionado)

ai_conversations
  - id, user_id, mensajes_json, contexto_datos_json, created_at
```

### 3.4 El orquestador y los conectores

Cada canal implementa la misma interfaz. Esto es lo que te permite **agregar Falabella, TikTok Shop o lo que sea sin tocar nada existente**.

```typescript
interface ChannelConnector {
  name: string;
  type: 'pull' | 'push' | 'manual';
  capabilities: Set<'orders' | 'products' | 'inventory' | 'customers'>;

  fetchOrders(since: Date): Promise<RawOrder[]>;
  fetchProducts(since: Date): Promise<RawProduct[]>;
  fetchInventory?(): Promise<RawInventory[]>;

  normalizeOrder(raw: RawOrder): NormalizedOrder;
  normalizeProduct(raw: RawProduct): NormalizedProduct;

  healthCheck(): Promise<HealthStatus>;
}
```

**Conectores por canal:**

| Canal | Estrategia | Frecuencia | Notas |
|-------|-----------|------------|-------|
| WordPress | REST API + webhooks de WooCommerce/plugin | Realtime + sync cada 1h | Confirmar si es WooCommerce o algo custom |
| Mercado Libre Colombia | API oficial MLM con OAuth | Cada 15 min orders, 1h productos | Requiere app registrada en MercadoLibre Developers |
| Dropi | Scraper del panel (no tiene API pública útil para proveedores) | Cada 30 min | Frágil; usar Playwright headless. Plan B: ingesta de exports CSV manuales |
| POS propio | Webhooks emitidos por el POS al orquestador | Realtime | Lo diseñamos juntos con tu programador del POS |
| WhatsApp | Formulario interno en el dashboard | Manual | El vendedor pega: cliente, productos, total |
| Falabella | API Sellercenter (Fase 3) | Cada 30 min | Esqueleto del conector queda en Fase 1 |

**Patrones del orquestador:**

- **Idempotencia** — toda ingesta usa `(canal, external_order_id)` como clave única.
- **Retries con backoff** — si Mercado Libre falla, reintenta 3 veces con espera creciente.
- **Dead letter queue** — eventos que fallan tras retries se guardan para revisión.
- **Observabilidad** — cada conector reporta a una tabla `connector_runs` (timestamp, duración, registros procesados, errores).
- **Backfill** — comando manual para repoblar histórico cuando se agrega un canal.

### 3.5 La capa de IA

Dos modos de operación:

**Modo autónomo (scheduled insights):**

Dos veces al día (8:00 AM y 6:00 PM hora Colombia), un job:

1. Toma snapshots de los marts (ventas del día, top productos, anomalías estadísticas, stock crítico, productos sin movimiento).
2. Construye un prompt estructurado con esos datos.
3. Llama al modelo (Kimi K2 o el que elijas).
4. Parsea la respuesta en `ai_insights` con tipo, severidad, acción sugerida.
5. El dashboard muestra el feed "Novedades del día" en la mañana y "Cierre del día" en la tarde.

**Modo conversacional (chat con tus datos):**

El usuario pregunta cosas en lenguaje natural. La arquitectura:

1. Su pregunta entra al backend.
2. Un primer paso (router) decide qué datos cargar: ¿necesita ventas del último mes? ¿Datos de un SKU específico? ¿Comparativo entre canales?
3. Se construye un contexto con los datos relevantes (resúmenes pre-calculados, no la base entera).
4. Se manda al modelo con un system prompt que define su rol.
5. La respuesta vuelve al chat. Opcionalmente, propone una acción (que en esta v1 solo se sugiere, no se ejecuta).

**Sobre Kimi K2 vs alternativas:** Kimi K2 (de Moonshot AI) tiene buena relación costo/calidad para texto en español y razonamiento. Alternativas a considerar:

- **Claude Haiku 4.5:** muy bueno en análisis estructurado, ~$1/M tokens input. Probablemente la mejor opción precio/calidad para este caso.
- **GPT-4o-mini:** muy barato, suficiente para resúmenes.
- **Gemini 2.5 Flash:** opción Google.

Recomendación: dejar el cliente LLM como **adaptador con interfaz común** (`LLMProvider`), igual que los conectores de canales. Así puedes cambiar de Kimi a Claude a GPT con una variable de entorno y comparar resultados sin reescribir nada.

### 3.6 El matching de productos (lo más crítico)

Estrategia en cascada, de más confiable a menos confiable:

1. **EAN/código de barras** si existe → match exacto, score 1.0.
2. **Código interno del proveedor** (si tu cliente lo tiene) → match exacto, score 1.0.
3. **Match exacto de nombre normalizado** (lowercase, sin tildes, sin caracteres especiales) → score 0.9.
4. **Match por embeddings de texto** (nombre + descripción) usando un modelo de embeddings barato → score variable, threshold a calibrar.
5. **Match por imagen** (CLIP o similar) si tenemos las imágenes de cada canal → score variable.
6. **Match por LLM** como árbitro final cuando los métodos anteriores no son concluyentes — se le pasan los candidatos y decide si son el mismo producto.

Todo lo que no pasa con score alto va a una **cola de validación humana** en el dashboard donde tú o el cliente confirman con un clic. El sistema aprende: cada validación humana refuerza las reglas.

### 3.7 Seguridad y permisos

- **Auth** con Supabase Auth (email + password, opcionalmente magic link).
- **Roles:** `owner` (cliente y esposa, ven todo), `developer` (tú, ves todo + logs técnicos), `staff` (futuro: vendedor que solo ve su punto).
- **Row Level Security en Postgres** — incluso si alguien obtiene un token, solo accede a lo que su rol permite.
- **Secretos** (API keys de cada canal) en variables de entorno de Railway, nunca en Supabase ni en el frontend.
- **Auditoría** — tabla `audit_log` con quién hizo qué cuándo.

---

## 4. KPIs y vistas del dashboard

Más allá de lo que mencionaste, te propongo esto. Marcado **[MVP]** lo que va en Fase 1, **[v2]** para Fase 2 y **[IA]** lo que aporta la capa de IA.

### Vista principal — "Hoy"

- **[MVP]** Ventas del día consolidadas, con barra de progreso vs. promedio de los últimos 30 días del mismo día de la semana.
- **[MVP]** Desglose por canal (gráfico de barras).
- **[MVP]** Top 10 productos vendidos hoy.
- **[MVP]** Última hora: feed de transacciones en tiempo real.
- **[v2]** Ticket promedio del día y comparativo.
- **[IA]** Card "Novedades de la mañana" / "Cierre del día" con insights generados.
- **[v2]** Alertas activas (stock bajo, anomalías).

### Vista — "Productos"

- **[MVP]** Lista de SKUs maestros con filtros por categoría, canal, estado.
- **[MVP]** Hot por ventana: día, semana, mes. Tres rankings simultáneos.
- **[v2]** Velocidad de rotación (unidades/día promedio en los últimos 7/30/90 días).
- **[v2]** Productos en aceleración (tendencia positiva fuerte) vs. en declive.
- **[v2]** Días de inventario restante al ritmo actual (proyección simple).
- **[IA]** Candidatos a promoción — productos con stock alto + ventas en declive + margen suficiente. La IA explica el porqué.
- **[IA]** Productos "estrella escondida" — buena rotación en un canal, sin presencia en otros.
- **[v2]** Detalle por SKU: ventas históricas por canal, precio promedio, márgenes.

### Vista — "Canales"

- **[MVP]** Comparativo de ventas por canal (día, semana, mes).
- **[v2]** Mix de canales en el tiempo (gráfico de área apilada).
- **[v2]** Performance individual: ingresos, # órdenes, ticket promedio, conversión donde aplique.
- **[v2]** Canibalización detectada: mismo cliente comprando mismo producto en distintos canales (si hay identificador de cliente).
- **[IA]** Diagnóstico por canal: qué está funcionando, qué no, qué probar.

### Vista — "Inteligencia"

- **[IA]** Feed de insights (cards revisables, con feedback útil/no útil).
- **[IA]** Chat con tus datos.
- **[v2]** Anomalías detectadas estadísticamente (caída brusca, pico inusual).
- **[v2]** Cohortes de recompra: % de clientes que vuelven a los 30/60/90 días.
- **[v3]** Predicción de demanda por SKU para las próximas 2 semanas (modelo estadístico simple, ej. Prophet, no IA generativa).

### Vista — "Operación"

- **[MVP]** Health check de cada conector (última sincronización, errores).
- **[MVP]** Cola de matching pendiente (productos sin master_sku).
- **[v2]** Log de insights enviados y feedback recibido.

---

## 5. Plan de implementación por fases

### Fase 0 — Discovery y normalización (1–2 semanas)

**Objetivo:** entender el catálogo real antes de construir.

Entregables:
- Inventario de fuentes con conteo real de productos por canal.
- Confirmación de qué identificadores comunes existen (barcode, código proveedor).
- Export estructurado del catálogo de cada canal (CSVs).
- Primer cruce manual + IA para estimar % de productos que harán match fácil vs. duro.

Dependencias: necesitamos respuestas del cliente sobre identificadores y acceso a cada plataforma.

### Fase 1 — MVP de ingesta y dashboard (3–4 semanas)

**Objetivo:** tener ventas consolidadas reales en pantalla.

Entregables:
- Esquema Supabase desplegado.
- Orquestador en Railway con conectores: **WordPress, POS propio, WhatsApp (formulario manual)**.
- Pipeline de matching: barcode → nombre exacto → embeddings → LLM árbitro.
- Cola de validación de matches.
- Dashboard Next.js con: vista "Hoy", "Productos" básica, "Operación".
- Auth y roles.

Métrica de éxito: ventas del día reflejadas con menos de 15 minutos de latencia, ≥80% de productos con master_sku asignado.

### Fase 2 — Canales restantes y analítica avanzada (2–3 semanas)

**Objetivo:** completar la foto omnicanal y empezar a ver insights útiles.

Entregables:
- Conectores: **Mercado Libre Colombia, Dropi**.
- Marts adicionales: velocidad, tendencias, días de inventario, canibalización.
- Vista "Canales" completa.
- Alertas reactivas (stock bajo, anomalías) por email.
- Esqueleto del conector de Falabella sin habilitar.

Métrica de éxito: los 5 canales actuales reportando al sistema, ≥3 alertas accionables generadas en la primera semana.

### Fase 3 — Capa de IA (2–3 semanas)

**Objetivo:** IA autónoma generando valor.

Entregables:
- Adaptador `LLMProvider` con soporte para Kimi K2, Claude y GPT (para comparar).
- Job de insights matutino y vespertino.
- Feed de insights en el dashboard con feedback.
- Chat conversacional con tus datos (RAG sobre los marts).
- Prompts versionados y testeables.

Métrica de éxito: 70% de los insights marcados como "útiles" después de 2 semanas de uso.

### Fase 4 — Predicción y Falabella (2 semanas, opcional)

- Activar conector Falabella cuando cliente esté listo.
- Modelo de predicción de demanda (Prophet u otro).
- Recomendador de reposición.

**Cronograma total estimado: 10–14 semanas para todo. MVP utilizable a las 4–6 semanas.**

---

## 6. Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|--------|--------------|------------|
| Catálogo no se puede normalizar bien con IA | Media | Cola de validación humana + iterar prompts; aceptar 90% automático + 10% manual |
| Dropi cambia su panel y rompe el scraper | Alta | Plan B: ingesta de CSV manual; monitoreo de health check |
| Mercado Libre rate-limits | Baja | Backoff exponencial; sincronización incremental |
| WhatsApp manual no se llena con disciplina | Media | Diseño del formulario tipo "máximo 4 clics"; recordatorios al cierre del día |
| El POS no emite eventos a tiempo | Media | Polling de respaldo + alerta si llevamos >2h sin recibir nada |
| Costos de IA se disparan | Baja | Caching de respuestas a queries similares; tope de tokens diario configurable |
| Cliente no tiene acceso o credenciales a algún canal | Alta | Documentar requisitos antes de Fase 1; bloquear conector si falta credencial |

---

## 7. Decisiones que necesito de ti/el cliente antes de Fase 1

1. **Identificadores de producto:** confirmar si existe algún código común (barcode, código proveedor). Si no, asumir matching por IA desde el día uno.
2. **POS propio:** stack del programador y si va a aceptar emitir webhooks.
3. **WordPress:** confirmar si es WooCommerce u otra cosa.
4. **Credenciales Mercado Libre:** crear app de developer y compartir keys.
5. **Acceso a Dropi:** usuario y contraseña del panel (variables seguras).
6. **Formato del feed de IA:** ¿cards en el dashboard solamente, o también email/WhatsApp resumen?
7. **Modelo de IA inicial:** ¿arrancamos con Kimi K2 o con Claude Haiku mientras Kimi se contrata?

---

## 8. Próximos pasos inmediatos

1. Tú y yo confirmamos arquitectura y plan (este documento).
2. Cliente revisa, aprueba presupuesto y entrega lo del punto 7 de arriba.
3. Yo te ayudo a montar el repo, el esquema de Supabase y el primer conector (WordPress) como walking skeleton.
4. Una vez tengamos WordPress fluyendo, replicamos el patrón para POS y WhatsApp.
5. En paralelo, exportamos catálogos de cada canal y arrancamos Fase 0 de normalización.

---

*Documento vivo. Última actualización: 13 de mayo de 2026.*
