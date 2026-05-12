# Context Notes

Topic-keyed running notes carried verbatim from the source docs. These are reference-only; decisions live in `decisions.md`, requirements in `requirements.md`, constraints in `constraints.md`.

---

## Topic: business context

- **Source:** `docs/PRD.md` §1
- **Notes:**
  - Cliente vende telenovedades (televentas) en Colombia.
  - Canales actuales: WordPress, Mercado Libre Colombia, Dropi (proveedor), 2 POS físicos, WhatsApp Business.
  - Canal próximo: Falabella Marketplace Colombia (no prioritario).
  - Volumen: ~5.000 transacciones/mes consolidadas.
  - Usuarios: 3 (desarrollador, cliente, esposa del cliente).
  - Presupuesto: $150 USD/mes en infra + servicios.
  - Catálogo: miles de SKUs con variantes, sin normalización entre canales, sin identificadores comunes confirmados.
  - IA: Kimi K2 candidato; modos = sugerencias autónomas (AM/PM) + chat bajo demanda.

---

## Topic: two parallel challenges

- **Source:** `docs/PRD.md` §2
- **Notes:**
  - Reto técnico: orquestador + DB unificada + dashboard + IA. Determinístico, sabemos cómo se hace.
  - Reto de calidad de datos: sin catálogo maestro confiable, las analíticas son ruido. Es el reto más grande del proyecto. La IA aporta valor desde el día uno como motor de matching, no como analítica.
  - Por eso el plan tiene Fase 0 dedicada a normalización; la IA aparece antes de lo habitual en el roadmap.

---

## Topic: cost rationale

- **Source:** `docs/PRD.md` §3.2
- **Notes:**
  - Supabase $0 → $25 Pro. Maneja 5K transacciones/mes sin problema; RLS para permisos; auth incluida.
  - Railway $5–10 para cron jobs + workers.
  - Vercel $0 free tier para Next.js 14.
  - Kimi K2 (o alternativa) $20–50 pago por uso; ~$0.50/día con uso moderado.
  - WhatsApp como mini-app interna en Fase 1 ($0) para evitar WhatsApp Business API.
  - Monitoring: Better Stack o Axiom free tier.
  - Total estimado $50–85/mes con ~$65 de headroom bajo el cap de $150.

---

## Topic: connector strategies (per channel cheatsheet)

- **Source:** `docs/PRD.md` §3.4 (table)
- **Notes:**
  - **WordPress:** REST API + WooCommerce/plugin webhooks. Realtime + sync cada 1h. Confirmar si es WooCommerce o custom.
  - **Mercado Libre Colombia:** API oficial MLM con OAuth. Orders cada 15 min, productos cada 1h. Requiere app registrada en MercadoLibre Developers.
  - **Dropi:** Scraper del panel proveedor (no tiene API pública útil). Cada 30 min. Frágil; usar Playwright headless. **Fallback: CSVConnector (per ADR-001 LOCKED — supersede el original "Plan B").**
  - **POS propio:** Webhooks emitidos por el POS al orquestador. Realtime. Diseño co-pactado con el programador del POS.
  - **WhatsApp:** Formulario interno en el dashboard. Manual. Vendedor pega cliente + productos + total.
  - **Falabella:** API Sellercenter (Fase 3). Cada 30 min. Esqueleto en Fase 1.

---

## Topic: AI usage rationale

- **Source:** `docs/PRD.md` §3.5
- **Notes:**
  - Modo autónomo: dos jobs/día (8 AM y 6 PM Colombia) → toman mart snapshots → arman prompt → llaman LLM → parsean a `ai_insights`.
  - Modo conversacional: router decide qué datos cargar → contexto pre-resumido (no la DB entera) → system prompt definido → respuesta con acción opcional (sólo sugerencia en v1).
  - Kimi K2: buena relación costo/calidad para español + razonamiento.
  - Alternativas: Claude Haiku 4.5 (mejor precio/calidad para análisis estructurado, ~$1/M tokens input); GPT-4o-mini (barato, suficiente para resúmenes); Gemini 2.5 Flash (opción Google).
  - Recomendación: `LLMProvider` adapter para swap por env var, mismo patrón que los connectors.

---

## Topic: matching cascade rationale

- **Source:** `docs/PRD.md` §3.6
- **Notes:** Cascada de más a menos confiable: EAN/barcode → código interno proveedor → nombre normalizado → embeddings de texto → match por imagen (CLIP) → LLM como árbitro final. Todo lo de score bajo va a cola de validación humana; cada validación humana refuerza las reglas.

---

## Topic: risk register

- **Source:** `docs/PRD.md` §6
- **Notes:**
  - Catálogo no se puede normalizar bien con IA (Media) → cola humana + iterar prompts; aceptar 90/10.
  - Dropi cambia su panel (Alta) → **CSV upload primario per ADR-001** + health check.
  - Mercado Libre rate-limits (Baja) → backoff exponencial; sincronización incremental.
  - WhatsApp manual no se llena (Media) → formulario de 4 clics + recordatorios al cierre.
  - POS no emite eventos a tiempo (Media) → polling de respaldo + alerta si >2h sin recibir.
  - Costos IA disparados (Baja) → caching de queries similares + tope diario de tokens.
  - Cliente sin acceso o credenciales (Alta) → documentar requisitos antes de Fase 1; bloquear conector si falta credencial.

---

## Topic: amendment rationale (CSV first-class)

- **Source:** `docs/AMENDMENT-csv-source.md`
- **Notes:**
  - Por qué importa:
    1. Desbloquea Fase 0 — sin CSV ingestion no se pueden cargar los exports históricos para el matching exploratorio.
    2. Reduce riesgo — si ML o Dropi rompen su API, el negocio sigue cargando vía CSV. Cero downtime de datos.
    3. Permite backfill ilimitado — histórico de años previos sin tocar connectors.
    4. Histórico inmutable — payload crudo en Storage + raw permite reprocesar con mappings corregidos sin perder datos.

---

## Topic: pre-Phase-1 open decisions

- **Source:** `docs/PRD.md` §7
- **Notes:** Siete preguntas que deben cerrarse antes de arrancar Fase 1 — ver `REQ-open-decisions-pre-phase-1` para la lista accionable.

---

## Topic: next immediate steps (PRD §8)

- **Source:** `docs/PRD.md` §8
- **Notes:**
  1. Confirmar arquitectura y plan (este documento).
  2. Cliente revisa, aprueba presupuesto, entrega lo del punto 7 del PRD.
  3. Montar repo + esquema Supabase + primer connector (WordPress) como walking skeleton.
  4. Una vez fluya WordPress, replicar patrón para POS y WhatsApp.
  5. En paralelo, exportar catálogos por canal y arrancar Fase 0 de normalización (que, por ADR-001, ya ingiere los CSVs vía `CSVConnector`).

---

## Topic: document provenance

- **Sources:**
  - `docs/PRD.md` — Dashboard Omnicanal de Ventas + Capa de IA. Última actualización 13 de mayo de 2026. PRD (precedence 2, not locked).
  - `docs/AMENDMENT-csv-source.md` — Amendment 001, fecha 2026-05-13, Estado LOCKED, Decisor Nicolás. Treated as ADR (precedence 0, LOCKED) per manifest override.

---
