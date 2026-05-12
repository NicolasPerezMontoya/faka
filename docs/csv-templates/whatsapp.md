# Plantilla CSV — WhatsApp (ventas manuales)

## Cómo exportar

WhatsApp Business no tiene API export. El cliente registra las ventas en **algún lugar** — necesitamos saber dónde y traerlo aquí.

**Posibilidades habituales:**
- Una libreta física → digitar manualmente.
- Un Excel/Google Sheets compartido → exportar como CSV.
- Mensajes guardados en el mismo WhatsApp → revisar últimos 30 días y digitar.
- Comprobantes de pago (Nequi/Bancolombia) cruzados contra mensajes → trabajo manual.

**Para Fase 0**, el cliente envía un Excel o CSV con las ventas WhatsApp del **último mes calendario completo**. Si no tienen sistema, el dev les pasa esta plantilla en blanco como Google Sheet y la llenan a mano.

> **No estamos diseñando el formulario aún** (eso es Fase 3). Aquí solo necesitamos los datos pasados para correr el matching exploratorio.

---

## `whatsapp-orders-YYYY-MM-DD.csv` — columnas

| Columna canónica | Tipo | Requerido | Ejemplo | Comentario |
|------------------|------|-----------|---------|------------|
| `external_order_id` | string | ✅ | `WA-2026-0512-01` | Formato libre — `WA-YYYY-MMDD-NN` funciona. El dev lo asigna si no existe. |
| `order_date` | date ISO | ✅ | `2026-05-12` | |
| `customer_phone` | string | ⚠️ recomendado | `+573001234567` | Es el ID natural del cliente WhatsApp. |
| `customer_name` | string | opcional | `Ana Gómez` | |
| `customer_city` | string | opcional | `Cali` | Útil si despachan por mensajería. |
| `seller` | string | ⚠️ recomendado | `María` | Quién atendió la venta (clientes vs esposa o staff). |
| `products_text` | string | ✅ | `2x Plancha Pro Rojo + 1x Cepillo eléctrico azul` | Texto libre de lo que pidieron. El matcher lo intenta resolver contra el catálogo. |
| `total` | decimal | ✅ | `199800` | |
| `payment_method` | enum | ⚠️ recomendado | `nequi` / `bancolombia` / `daviplata` / `efectivo` / `otro` | |
| `delivery_method` | enum | opcional | `recoge_tienda` / `domicilio_local` / `envio_nacional` | |
| `status` | enum | ✅ | `pagado` / `pendiente_pago` / `pendiente_envio` / `entregado` / `cancelado` | |
| `notes` | string | opcional | `Cliente pide entrega mañana 3pm` | |

---

## Por qué `products_text` es libre

Las ventas por WhatsApp **rara vez se registran a nivel SKU**. La cliente escribe "una plancha roja y un cepillo" y se cierra el trato. Pedir al cliente que descomponga en SKUs es:
1. Lento — no van a hacerlo bien.
2. Innecesario — el matcher exploratorio (con embeddings + LLM) puede resolver textos libres contra el catálogo maestro.

**Trade-off aceptado:** matching de WhatsApp tendrá menor precisión que matching estructurado (WP/ML). Eso está bien para Fase 0 (entender el orden de magnitud) y para Fase 3 (cuando el formulario nuevo capture mejor).

---

## Estructura mínima viable

Si el cliente no tiene NADA registrado y no quiere digitar 30 días para atrás, lo mínimo aceptable para Fase 0:
- 10 ventas representativas de WhatsApp del último mes con: fecha, qué se vendió (texto libre), total.

Mejor 10 reales que 200 inventadas. El matcher se calibra igual.
