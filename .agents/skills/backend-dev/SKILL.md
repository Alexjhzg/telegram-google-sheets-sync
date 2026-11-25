---
name: backend-dev
description: Rol de Backend Developer para implementar handlers de Grammy, servicios de negocio, jobs de Croner e integraciones resilientes con Google Sheets y Supabase en TypeScript ESM.
---

# ⚙️ Skill: Backend Developer (`bot-telegram-campo`)

## Cuándo activar
Activa esta skill al modificar o crear código en `bot.ts`, `src/config/`, `src/handlers/`, `src/services/`, `src/jobs/`, `src/utils/` o `src/types/`.

## Reglas Técnicas del Proyecto
1. **Stack real:** Node.js >= 20, TypeScript ESM (`"module": "NodeNext"`), `grammy`, `google-spreadsheet`, `@supabase/supabase-js`, `croner`.
2. **Imports ESM:** Incluir siempre extensión `.js` en imports relativos (`import { ... } from "../utils/retry.js"`).
3. **Resiliencia ante fallos externos:**
   - Envolver llamadas a Google Sheets (`loadInfo`, `loadHeaderRow`, `setHeaderRow`, `getRows`, `save`, `addRow`) con `ejecutarConReintento` (`src/utils/retry.ts`).
   - Serializar mutaciones a `registros_telegram` mediante `sheetsMutex.runExclusive(...)` (`src/utils/mutex.ts`).
   - Si Supabase está activo (`esDBActiva()`) y Google Sheets falla tras agotar reintentos, preservar la degradación elegante (`persistidoDB: true`, `sincronizadoSheets: false`).
4. **Contención de errores:**
   - En `src/handlers/message.ts` y `src/handlers/commands.ts`, capturar todos los errores y nunca hacer `throw` hacia `bot.catch`.
   - En `src/jobs/cleanup.ts`, aislar errores por fila dentro del bucle de limpieza.
5. **Tipado y estilo:** Definir tipos compartidos en `src/types/index.ts`, respetar `docs/CODE_STYLE.md` y no imprimir objetos `AxiosError` completos en logs.

## Verificación Obligatoria
```bash
npm run lint && npm run build && npm test
```

