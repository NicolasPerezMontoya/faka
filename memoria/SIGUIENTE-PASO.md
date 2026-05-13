# Siguiente paso — qué hacer en la próxima sesión

## Pregunta de apertura sugerida

> "¿Cómo va el CI? ¿Pude completar el deploy de F1 a staging?"

Esto le da contexto al modelo nuevo para evaluar dónde quedamos.

## Orden recomendado de acciones

### 1. Verificar CI verde

```bash
gh run list --repo NicolasPerezMontoya/faka --limit 3
```

**Estado actual (2026-05-14)**: CI verde **y estricto** desde `796540e`. Run de referencia: `25824861447`. Ver `memoria/CI-FIXES.md` para la historia completa.

Gates activos: Install, Lint, **Format check (strict)**, **Type check (strict)**, Unit tests, Supabase start, Migrations, **Assert types committed (strict)**, Integration tests, Stop.

Si tocas migrations: corre `pnpm db:types` y commitea el resultado o CI falla.

### 2. Si aún no desplegaste: seguir `memoria/SETUP.md`

Pasos resumidos:

1. Crear proyecto Supabase staging
2. Aplicar las 13 migrations (CLI o SQL editor)
3. Seed Super Admin
4. Verificar Auth Hook configurado
5. Vercel deploy (Root Dir = apps/dashboard, 3 env vars)
6. Railway deploy (railway.toml auto-detect, 4 env vars)
7. `bash scripts/smoke.sh <dashboard> <orchestrator>` → exit 0
8. Login en `<dashboard>/login` como Super Admin

### 3. Si Phase 1 está LIVE: arrancar Phase 2

```
/gsd-plan-phase 2
```

Phase 2 es **WordPress walking skeleton**: primer canal real end-to-end. Entregables esperados:

- WordPress connector real (no skeleton): OAuth o REST API key, fetchOrders + fetchProducts
- Pipeline de matching cascada en SQL functions (barcode → supplier_code → sku → normalized_name → LLM arbiter stub)
- Cola de validación humana en `apps/dashboard/app/(app)/operacion/cola-validacion/`
- Vista "Hoy" mínima en `apps/dashboard/app/(app)/hoy/`
- Test e2e: subir CSV de productos WP → ventas WP del último mes → ver en "Hoy"

Tiempo estimado: 1–2 semanas (1.5–2x lo que tomó F1 al ritmo actual). 6 plans.

### 4. Items "client-blocked" que conviene cerrar en paralelo

Estos NO bloquean F2 pero conviene tenerlos para F3+:

- [ ] Cliente sube los 4 CSVs maestros: WP, ML, Dropi, POS (formato en `docs/csv-templates/`)
- [ ] Cliente crea developer app en https://developers.mercadolibre.com.co (bloquea F4)
- [ ] Cliente arranca trámite de Meta Business Manager para WhatsApp Cloud API (bloquea F5.5, tarda 1–2 sem en verificarse)
- [ ] Cliente confirma stack del POS + voluntad de webhooks (bloquea F3)

Mándale la lista al cliente la próxima vez que hables con él.

## Comandos útiles para retomar contexto

```bash
# Ver últimos commits con contexto de cada plan
git log --oneline -30

# Ver qué archivos cambiaron en cada wave
git log --oneline --stat -10

# Ver estado actual del workflow GSD
cat .planning/STATE.md

# Ver el plan completo de F1 con waves y deps
cat .planning/phases/1-foundation/PLAN.md | head -50

# Ver CI logs recientes
gh run list --repo NicolasPerezMontoya/faka --limit 5
```

## Si quieres acelerar F2 con `gsd-autonomous`

```
/gsd-autonomous
```

Esto corre discuss→plan→execute para todas las fases restantes sin pausar. **Solo recomendado** si ya tienes:

- Phase 1 deployed y validado
- Credenciales WP del cliente
- Comodidad con que ~28h de código sucedan sin tu review intermedio

Para F2 puntual te recomiendo el flujo normal (plan, revisar, ejecutar) — la primera vez que un canal real entra al sistema vale la pena el review.
