# Memoria — context handoff para continuar el proyecto

Estos documentos son tu "punto de retomado" si necesitas pausar y volver con contexto limpio. Léelos en orden:

1. **`ESTADO.md`** — qué se ha construido (Phase 0 + Phase 1 al 92% + Phase 2 Waves 0–1 en `9a4cd28`), qué decisiones LOCKED rigen el código, qué quedó deferred, y el roadmap completo de las 7 fases.
2. **`SETUP.md`** — el runbook concreto: tokens de Supabase que tienes, cómo configurar Railway + Vercel, cómo desbloquear CI, primer login como Super Admin.
3. **`SIGUIENTE-PASO.md`** — exactamente qué hacer en la próxima sesión para arrancar Phase 2 (WordPress walking skeleton).
4. **`CI-FIXES.md`** — cascada de 14 commits que llevaron al primer CI verde + deuda técnica para F2.
5. **`F2-PROGRESO.md`** — Phase 2 plan completo + Waves 0–1 completadas + lo que falta (Wave 2–5). Si retomas F2, **empieza aquí**.

## Referencias canónicas que NO repetimos aquí

Estos viven en el repo y son la verdad. Memoria solo apunta:

- **`docs/PRD.md`** — Producto y arquitectura completos
- **`docs/AMENDMENT-csv-source.md`** — ADR-001 LOCKED (CSV first-class)
- **`docs/ADR-002-role-matrix.md`** — LOCKED (4 roles column-level)
- **`docs/ADR-003-whatsapp-strategy.md`** — LOCKED (WhatsApp split F3/F5.5)
- **`docs/ADR-004-mini-crm.md`** — LOCKED (Mini-CRM en MASTER)
- **`docs/discovery-findings.md`** — Hallazgos del cuestionario respondido por el cliente
- **`DEPLOY.md`** — Runbook completo de despliegue (más detallado que `SETUP.md`)
- **`.planning/PROJECT.md`** — Decisiones del proyecto (LOCKED en tabla)
- **`.planning/ROADMAP.md`** — 7 fases con success criteria y dependencias
- **`.planning/REQUIREMENTS.md`** — 40 requirements con trazabilidad
- **`.planning/phases/1-foundation/PLAN.md`** — los 26 plans de F1

## Git history como timeline

`git log --oneline` muestra el orden cronológico de los 39+ commits.
Cada commit es un plan atómico de GSD; el mensaje explica qué hizo + a qué FND-NN / ADR-NN apunta.
