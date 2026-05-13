# ADR-003 — Estrategia WhatsApp: split form + integración

**Fecha:** 2026-05-13
**Estado:** LOCKED
**Decisor:** cliente (prefiere integración real) + dev (split por pragmatismo)
**Supersede:** PRD §3.4 ("Mini-app interna para registro manual").

---

## Contexto

El PRD original proponía un formulario interno en el dashboard para registrar ventas de WhatsApp. El cliente prefiere **integración real con WhatsApp** porque:
1. El vendedor ya está dentro de WhatsApp Business; cambiar a otra app rompe su flujo.
2. Los insights IA del Bloque H deben **llegar al WhatsApp del dueño**, lo cual requiere un canal de salida WA de cualquier modo.

WhatsApp Business Cloud API (Meta directo) o un proveedor (Twilio, 360dialog) requieren:
- Meta Business Manager verificado
- Número de teléfono de negocio dedicado
- Plantillas de mensaje aprobadas (para mensajes proactivos)
- Webhook receiver desplegado y verificado
- Costo: ~USD 0.005–0.015 por mensaje business-initiated. Inbound del cliente: gratis.

Volumen estimado: 5–10 pedidos/día × 30 = 150–300 mensajes inbound/mes + 2 insights AM/PM × 30 = 60 mensajes outbound/mes. **Costo total estimado: USD 1–5/mes.** Cabe en presupuesto.

## Decisión

**Split en dos fases:**

### Fase 3 — Formulario interno (NO desaparece)

Mantener el formulario interno como entrada secundaria, no eliminarlo:
- Captura ventas WhatsApp registradas a mano (cuando el vendedor no usa el chat directo).
- Es el fallback si WA Business cae.
- Sirve como UI de "limpieza" para corregir pedidos mal capturados por la integración automática.

Form mínimo viable (≤4 clicks, según PRD): cliente · productos · total · método pago · canal=whatsapp.

### Fase 5.5 — Integración WhatsApp Business Cloud API (NUEVA)

Se inserta entre F5 (IA) y F6 (Falabella+predicción) porque depende de:
1. Capa de IA ya construida (los insights van por WA además de dashboard).
2. Mini-CRM existente (los pedidos WA crean/enriquecen `customers`).

**Entregables:**
- Cuenta WhatsApp Business + Meta Business Manager configurada (Nicolás coordina con cliente).
- Webhook receiver en Railway que valida firma de Meta.
- Parser de mensajes entrantes → flow conversacional simple:
  - "Pedido nuevo" → bot pregunta: cliente, productos (texto libre, lo resuelve la cascada de matching), total → confirma → crea `sales` row con `canal=whatsapp_bot`.
  - "Consulta" → reenviar al vendedor humano.
- Sender de mensajes outbound:
  - Insights AM/PM al teléfono del dueño (plantillas aprobadas: "AM", "PM", "alerta").
  - Notificaciones de stock crítico, productos en aceleración, anomalías.
- Adapter pattern `MessagingProvider` (igual que `LLMProvider`): permite swap entre WhatsApp Cloud API (default), Twilio, 360dialog si fuera necesario sin tocar call sites.

## Por qué split

1. **No retrasa el MVP usable** (F3 = WP + POS + form WhatsApp = ya tienes visión consolidada).
2. **Permite descubrir el setup de Meta sin presión** (el proceso de verificación de número puede tardar 1–2 semanas; lo arrancamos en paralelo con F4).
3. **Los insights por WA dependen de la IA**, así que ponerlos en F5.5 (después de F5) es natural.
4. **El form se queda permanente** — no es trabajo desechable. Si la integración WA tiene un downtime, el form sigue funcionando.

## Implicaciones

- `ROADMAP.md`: insertar Fase 5.5 entre F5 y F6 (cronograma renumerado a F0..F6.5 o usando decimales).
- `REQUIREMENTS.md`: `REQ-whatsapp-form` (F3) + `REQ-whatsapp-cloud-api` (F5.5) + `REQ-messaging-provider-adapter` (F5.5).
- `PROJECT.md`: Key Decisions — ADR-003 LOCKED.
- Presupuesto: +USD 1–5/mes por mensajería. Total $50–90/mo, sigue dentro de $150 cap.
- **Riesgo nuevo**: verificación de número de Meta puede tardar 1–2 semanas. Mitigación: arrancar trámite en cuanto F4 inicie.

## Lo que NO se hace

- **No** botón "comprar" desde WhatsApp en F5.5. El bot solo captura pedidos que el vendedor o cliente describen. La negociación sigue siendo humana.
- **No** integración WhatsApp Web scraping. Solo WA Business Cloud API oficial.
- **No** soporte multi-número. Un solo número de negocio por ahora; multi-tenant queda para futuro si crece.
