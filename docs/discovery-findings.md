# Discovery Findings — Fase 0

**Fecha:** 2026-05-13
**Fuente:** `docs/discovery-questionnaire.md` (respondido por cliente vía Nicolás) + comentarios adicionales en sesión.
**Estado:** READY — informa los ADRs 002–004 y los ajustes a ROADMAP/REQUIREMENTS.

---

## TL;DR

El cliente no tiene cifras exactas y no le interesa estimarlas. El sistema debe ser **robusto al volumen y al desorden inicial**, aprender incrementalmente y no preguntar dos veces por el mismo producto.

**Lo que confirma la arquitectura del PRD + ADR-001:**
- Identificadores existen en algún registro (barcode, código proveedor) aunque no estén cargados en cada canal. La cascada de matching + cola de validación humana es exactamente el mecanismo correcto.
- CSV upload de primera clase: Dropi exporta CSV, WP/ML/POS también. Validación de ADR-001.
- Mart `dead_stock` (referencias sin movimiento) es el caso de uso de mayor valor según el cliente.

**Lo que cambia respecto al PRD:**
- 4 roles con matriz column-level (no 3 row-level). Locked en ADR-002.
- WhatsApp: integración real, no formulario interno. Estrategia split (ADR-003).
- Mini-CRM: nuevo deliverable de primera clase (ADR-004).
- Taxonomía maestra: construida por el sistema, no asumida. Refinamiento de F1.

---

## Respuestas consolidadas + interpretación

### A. Catálogo
- **Tamaño**: rango amplio. Asumo **entre 500 y 5000 SKUs** para dimensionamiento. La cascada + cola escalan a cualquier número; el `discovery-report` empírico lo precisa.
- **Identificadores presentes en algún registro**: ~80% barcode, ~100% código proveedor, ~70% SKU propio común. Crítico: **estos códigos pueden no estar cargados en cada canal**. El trabajo del sistema es:
  1. Aceptar el archivo maestro (POS o un Excel con la "verdad" del cliente).
  2. Hacer matching contra ese maestro desde cada canal.
  3. Para cada producto no resuelto, mostrar candidatos al usuario; un click guarda el mapping; nunca más se vuelve a preguntar (`product_mappings.validado_humano=true`).
- **Variantes**: ~20% del catálogo, manejo mixto entre canales. La cascada se aplica a nivel de variante (`master_variant_sku`), no solo producto.
- **Estado**: derivado por presencia/ausencia en cada plataforma (no por campo dedicado). El sistema genera el flag `descontinuado` cuando un SKU sale de todos los canales por X días.
- **Taxonomía**: cada canal tiene la suya, ~8 categorías raíz cliente-lado. **El sistema construye una taxonomía maestra**, no la asume. Nicolás + cliente la curan vía UI durante F1. Mapping `canal_categoria → master_categoria` se persiste y se aprende.

### B. Volumen
- ~5k tx/mes consolidadas (PRD). El cliente no diferencia por canal; lo descubriremos por los conectores.
- El sistema dimensiona para 10x ese rango sin tuning específico.

### C. Histórico
- Carga inicial **puede ser de un solo canal** para arrancar (no necesitamos los 5 a la vez). Pragmatismo aceptado.
- Backfill objetivo: **al menos último año por canal**, idealmente desde lo que esté disponible. Sin presión sobre tiempos de procesamiento — la ingesta histórica es un job batch, no afecta la operación diaria.

### D. Canales
| Canal | Lo claro | Lo pendiente | Acción |
|---|---|---|---|
| **WordPress** | URL: `catalogofakastore.com`. Admin disponible. Sin plugin de variantes. | Confirmar si es WooCommerce vs custom. Cuántos productos. Si tiene webhooks. | En primer screen-share, Nicolás revisa el wp-admin para confirmar. |
| **Mercado Libre** | Tienda: `letal-shark`. Usa Mercado Envíos y propios. | **No tiene developer app aún** → bloqueador de F4. | Crear app en developers.mercadolibre.com.co antes de F4. Documentado en blockers. |
| **Dropi** | Exporta CSV manualmente (confirmado). Cliente accede al panel. | Usuario/contraseña en búsqueda. | CSV manual es la ruta primaria; scraper queda como Fase opcional futura. |
| **POS** | Custom, programador disponible. | "Probablemente webhooks + CSV de respaldo" — necesita conversación técnica con el programador. | Diseño de webhook contract junto al programador como tarea de F3. Hasta entonces: CSV. |
| **WhatsApp** | 1 vendedor, 5–10 pedidos/día. Sin método de registro hoy. | **Cliente prefiere integración real, no formulario.** | Split: F3 = form interno (rápido, sin dependencias). F5.5 = WA Business Cloud API integration. Ver ADR-003. |

### E. Cliente final / Mini-CRM
- Captura de teléfono/cédula: casi nunca. Donde sí: WP (checkout), POS (cuando lo pegan), WhatsApp (por chat).
- **Cliente quiere mini-CRM**: directorio + primera compra + recurrencia + canales en los que ha comprado + productos comprados.
- **Realidad operativa**: solo podemos cubrir clientes de WP + POS + WhatsApp donde haya teléfono o documento capturado. ML/Dropi no exponen identidad real del comprador. La vista "Clientes" muestra explícitamente "% cobertura" para que el cliente sepa que no es exhaustivo.
- Lock: ver ADR-004.

### F. Costos / márgenes
- No documentados. "En la cabeza". Promociones aplicadas de 3 formas sin trazabilidad.
- **Decisión pragmática**: el dashboard muestra **ingresos** desde el día uno (de los canales/CSVs). **Margen** queda como `null` hasta que el cliente cargue un CSV de costos. UI muestra "margen estimado: no disponible — cargar CSV de costos" como acción sugerida.
- Promociones: capturamos `descuento` por línea cuando el CSV/API lo trae; lo que no, va como descuento `0`. No reconstruimos cómo se aplicó.

### G. Devoluciones
- **5% aprox**, más en Dropi y ML.
- Política: **solo capturamos lo que el CSV/API trae como `estado=devuelto` o `refunded`**. Sin UI de captura manual.

### H. Capa de IA
- Formato preferido: **dashboard cards** + **WhatsApp del dueño** (no email).
- Horas: AM 8:00, PM **5:30** (revisado vs default 6:00).
- Modelo: cliente "decide tú" — arrancamos con AI Gateway default (`anthropic/claude-haiku-4-5`), pivot si la tasa de rechazo > 30%.
- Tipos de insight concretos pedidos:
  - "Hoy tuviste menos ventas que ayer, podías mejorar X"
  - "El canal X cayó X% respecto a la semana pasada"
  - "Cerca de fin de mes y ya pasaste las ventas de los últimos 2–3 meses, felicitaciones"
  - "Estas N referencias no se han movido en X días — sugiero promoción"
- Estos ejemplos van directo al system prompt de Fase 5; los versionamos en `prompts/insights.v1.md`.

### I. Roles
- **4 roles con matriz column-level** (no 3 row-level del PRD). Lock: ADR-002.

### J. Operación
- Dolores ordenados: visualización · centralización · decisiones de compra.
- Decisión que cambiaría con la data: **promociones sobre stock muerto** + **qué comprar en próximas compras**. Esto confirma que `mart_dead_stock` y "recomendador de reposición" (Fase 6) son los killer features.

### K. Quirks
- "Varios" productos se llaman distinto entre canales (esperado).
- **2000+ referencias sin vencer hace 2 años**: stock muerto masivo. **Esta es la oportunidad de negocio número uno** del proyecto. `mart_dead_stock` sube de [v2] a MVP en Fase 3.

---

## Bloqueadores reales para F1

De los 7 puntos del PRD §7, así quedan:

| # | Punto | Estado | Acción |
|---|---|---|---|
| 1 | Identificadores | ✅ resuelto | Existen en algún registro; sistema los normaliza vía cascada |
| 2 | POS stack + webhooks | 🟡 parcial | Stack: custom. Programador disponible. Webhook design = tarea inicio de F3 |
| 3 | WordPress: WC o custom | 🔴 pendiente | Resolución en primer screen-share con el cliente (15 min, no bloquea) |
| 4 | Credenciales ML | 🔴 pendiente | Cliente debe **crear app developer** en MercadoLibre Developers. Bloquea F4, no F1. |
| 5 | Acceso Dropi | 🟡 buscando | No bloquea F1 (Dropi entra en F4 vía CSV) |
| 6 | Formato feed IA | ✅ resuelto | Dashboard cards + WhatsApp dueño |
| 7 | Modelo IA inicial | ✅ resuelto | Gateway / Claude Haiku 4.5 default, evaluable |

**Conclusión**: ninguno de los 7 puntos bloquea Fase 1 (Foundation). F4 (Mercado Libre) requiere que el cliente cree la developer app antes de empezar — agendamos eso en paralelo durante F1–F3.

---

## CSVs que necesito del cliente (priorizado)

Mínimo viable para correr `match-explorer`:

1. **Maestro propio del cliente** (Excel/CSV con barcode + código proveedor + nombre + categoría + costo si lo tienen). Aunque sea sucio. Este es el anchor.
2. **Catálogo de WordPress** (vía plugin Product Export).
3. **1 mes de pedidos de cualquier canal** para validar el flujo end-to-end.

Los demás CSVs (ML, Dropi, POS, WhatsApp) entran a medida que avancen las fases respectivas — no hay que tenerlos todos para empezar.
