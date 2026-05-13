# ADR-002 — Matriz de roles y permisos column-level

**Fecha:** 2026-05-13
**Estado:** LOCKED
**Decisor:** cliente (vía Nicolás)
**Supersede:** sección 3.7 del PRD original (3 roles `owner`/`developer`/`staff`).

---

## Decisión

Cuatro roles con matriz **column-level** (no solo row-level):

| Recurso                                                      | Super Admin |   Admin   | Manager |  Analista   |
| ------------------------------------------------------------ | :---------: | :-------: | :-----: | :---------: |
| Crear/editar usuarios y roles                                |     ✅      |    ❌     |   ❌    |     ❌      |
| Configurar conectores (API keys, webhooks)                   |     ✅      |    ✅     |   ❌    |     ❌      |
| Subir CSV / reprocesar uploads                               |     ✅      |    ✅     |   ✅    |     ❌      |
| Validar matches en cola humana                               |     ✅      |    ✅     |   ✅    |     ❌      |
| Ver volumen de transacciones (# órdenes, # productos)        |     ✅      |    ✅     |   ✅    |     ✅      |
| Ver datos de cliente final (teléfono, email, nombre, cédula) |     ✅      |    ✅     |   ❌    |     ❌      |
| Ver montos $ (ingresos, márgenes, ticket promedio, costos)   |     ✅      |    ✅     |   ✅    |     ❌      |
| Ver insights IA                                              |     ✅      |    ✅     |   ✅    |     ✅      |
| Chat con datos                                               |     ✅      |    ✅     |   ✅    | ⚠️ filtrado |
| Ver audit log / logs técnicos                                |     ✅      | ⚠️ propio |   ❌    |     ❌      |

Nota sobre Analista + chat: el chat debe poder responder preguntas de volumen y tendencias, pero **no debe revelar** montos $ ni identidad de clientes en respuestas. Implementado vía system prompt + filtros server-side post-respuesta antes de devolver al cliente.

## Implicaciones técnicas

1. **No basta con RLS row-level**. Necesitamos column-level grants en Postgres para esconder `total`, `subtotal`, `costo`, `discount` etc. a `manager`, y todos los campos $-flagged + cliente-flagged a `analista`.

2. **Patrón implementación**:
   - Tablas `sales`, `sale_items`, etc. exponen vistas por rol:
     - `sales_view_admin` — todas las columnas
     - `sales_view_manager` — sin columnas de cliente, con $
     - `sales_view_analista` — sin $ ni cliente; solo conteo / volumen / categorías
   - El cliente Supabase obtiene la vista según rol vía JWT claim.
   - Política RLS sobre las **tablas base** + grants explícitos sobre **vistas**.

3. **JWT claims**:
   - `role` ∈ {`super_admin`, `admin`, `manager`, `analista`}
   - El AuthContext en Next.js valida y propaga.

4. **Tabla `audit_log`** captura quién (user_id + role en el momento) hizo qué cuándo, sobre qué fila. Visible para Super Admin completo, Admin solo lo propio.

5. **Seeding**: el primer Super Admin se crea vía CLI (script de F1) con email `nicolasperezmontoya@gmail.com`. Los demás usuarios los crea Super Admin desde la UI de F1.

## Cambios derivados

- `REQUIREMENTS.md`: actualizar `REQ-security-and-permissions` con esta matriz; agregar `REQ-column-level-rls`.
- `PROJECT.md`: Key Decisions table — agregar ADR-002 LOCKED.
- Fase 1 (Foundation): incluye creación de las 4 vistas por rol + grants + JWT-claim middleware.
- Fase 5 (IA chat): system prompt incluye instrucción de no revelar $ ni clientes según rol del solicitante.

## Por qué importa

Sin esta matriz, un Analista podría ver el margen real del negocio o exportar el directorio de clientes — riesgo operativo y de confianza con el cliente. Definirlo ahora cuesta 1 día de schema; reconstruirlo después de F2 costaría una migración con downtime y reescribir todas las queries del dashboard.
