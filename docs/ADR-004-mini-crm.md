# ADR-004 — Mini-CRM como entidad de primera clase

**Fecha:** 2026-05-13
**Estado:** LOCKED
**Decisor:** cliente
**Supersede:** PRD §3.3 (capa MASTER no incluía `customers` como entidad nombrada — solo `cliente_externo_id` en `sales`).

---

## Decisión

Construir un **mini-CRM** (no un CRM completo) como parte de la capa MASTER, no como mart derivado. Tres tablas + una vista + cobertura explícita en UI.

## Modelo

```
customers
  - customer_id         (PK UUID propio)
  - displayed_name      (mejor texto disponible — nombre, alias, número)
  - phone               (E.164 normalizado, nullable)
  - email               (lowercase trimmed, nullable)
  - document_id         (cédula u otro doc nacional, nullable, hash si privacy)
  - first_purchase_at
  - last_purchase_at
  - total_purchases     (int)
  - total_spent         (decimal, NULL para roles sin permiso $)
  - channels_purchased  (array de canales donde ha comprado)
  - tags                (array libre — manual o IA-suggested)
  - notes               (texto libre para staff)
  - created_at, updated_at

customer_external_links
  - customer_id (FK)
  - canal               (wordpress / mercadolibre / dropi / pos / whatsapp)
  - external_customer_id  (su ID en ese canal)
  - external_identifier_type   (email / phone / nickname / document)
  - merged_method       (auto_phone / auto_email / auto_document / manual)
  - created_at

customer_merge_log
  - merged_at, merged_into (FK customer_id), merged_from (FK customer_id), method, validated_by
```

`sales.customer_id` se llena cuando el matching de cliente resuelve. NULL aceptado (la venta vale igual aunque no sepamos a quién fue).

## Lógica de matching de clientes (espejo del producto matching)

Cascada en cascada:
1. **Phone exact** (E.164 normalizado): match exacto.
2. **Email exact** (lowercase trim): match exacto.
3. **Document exact**: match exacto.
4. **Phone fuzzy** (último 7 dígitos): match con score, requiere validación humana si hay múltiples candidatos.
5. **Otherwise**: crea un nuevo `customers` row con `displayed_name` derivado del nombre disponible.

Igual que el matching de productos: lo que la cascada no resuelve va a una **cola de validación** (separada de la de productos, misma UI pattern). Un click humano fija el mapping → nunca más se vuelve a preguntar.

## Cobertura visible en UI

La vista **Clientes** debe mostrar arriba:
- "%  de transacciones con cliente identificado" (visible al rol que pueda ver volumen).
- Desglose por canal (WP: 65%, POS: 40%, WhatsApp: 80%, ML: 0%, Dropi: 0%).

Esto es transparencia con el cliente: no inventamos cobertura que no existe, y le da motivo para empezar a capturar identificador en POS si quiere mejorar la cobertura.

## Permisos (cruza con ADR-002)

- **Super Admin / Admin**: ven todo.
- **Manager**: NO ve `customers` ni columnas relacionadas. Solo recibe `customer_id=null` en sus vistas.
- **Analista**: igual que Manager + sin montos $.

## Ubicación en el roadmap

**Fase 4 (Mercado Libre + Dropi + analítica avanzada)** absorbe la implementación porque:
1. Necesita los marts ya construidos.
2. La cascada de matching de clientes reutiliza la infra de matching de productos (F2).
3. La vista "Clientes" se complementa con el resto del dashboard.

Esto **expande F4 de 2 sem a 2–3 sem**. Aceptable.

## Lo que NO es

- **NO** es un CRM tipo HubSpot/Salesforce. Sin pipeline de ventas, sin tareas, sin emails masivos, sin segmentación avanzada.
- **NO** envía comunicaciones automatizadas a clientes finales (eso requiere más permisos y políticas de privacidad).
- **NO** scoring de cliente. Mostramos: "primera compra", "recurrente (Nx)", "canales", "productos comprados" — datos crudos, sin opinión del sistema.

## Costos / efectos

- Sin costo de infra nueva — vive en Supabase Postgres + Storage existente.
- Privacy: cuando el cliente solicite "olvídame", `customers.phone/email/document_id` se anonimizan; las `sales` quedan con `customer_id` pero el nombre cambia a "Cliente anónimo NNNN".
- LGPD/HabeasData Colombia: nota para Nicolás — habrá que agregar una política simple en el dashboard. Es trabajo de F4.
