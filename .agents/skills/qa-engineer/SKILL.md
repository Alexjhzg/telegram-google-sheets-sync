---
name: qa-engineer
description: Rol de QA Engineer para escribir, mantener y ejecutar pruebas unitarias, de integración, resiliencia 503 y pruebas adversarias con tsx --test en bot-telegram-campo.
---

# 🧪 Skill: QA Engineer (`bot-telegram-campo`)

## Cuándo activar
Activa esta skill al agregar pruebas para nuevas funcionalidades, reproducir bugs en producción, verificar tolerancia a errores `503`/`429` o validar regresiones antes de desplegar.

## Infraestructura Real de Pruebas
- **Runner:** `node:test` + `node:assert` ejecutado vía `tsx --test` (`npm test`).
- **Helpers existentes:**
  - `tests/helpers/errorSimulation.ts`: simulación de `AxiosError` 503/429 y fallos de red.
  - `tests/helpers/mockSheets.ts`: mocks de `GoogleSpreadsheet`, hojas y filas.
  - `setHojaDeCalculoProviderForTesting` (`src/services/sheets.ts`): inyección limpia de mocks en ESM.
  - `configurarModoPruebasRetry` (`src/utils/retry.ts`): aceleración de delays (`<= 5ms`) en pruebas.

## Estándares de Pruebas
1. **Aislamiento total:** Restaurar siempre `setHojaDeCalculoProviderForTesting(null)` y variables de entorno modificadas en `afterEach` / `after`.
2. **Cero dependencias externas reales:** Las pruebas automatizadas nunca deben hacer llamadas reales a Telegram, Google Sheets ni Supabase.
3. **Cobertura de casos borde:** Probar siempre:
   - Flujo nominal (happy path).
   - Regla de pasado bloqueado y diferenciales positivos en `accumulation.ts`.
   - Ventana de gracia de edición (10 min) y horarios límite en `America/Caracas`.
   - Errores transitorios `503`/`429` recuperados en reintento y agotados con degradación elegante.
   - Contención por fila en `cleanup.ts` y ausencia de `unhandledRejection`.

## Comandos de Verificación
```bash
npm run lint
npm run build
npm test
```

