# 📏 Guía de Estilo de Código (`CODE_STYLE.md`)

Esta guía define los estándares de formato, tipado, arquitectura y calidad de código para `bot-telegram-campo` (Node.js >= 20, TypeScript ESM, Grammy, Supabase, Google Sheets).

---

## 1. Herramientas Automáticas

| Herramienta              | Archivo de Configuración                    | Comando                                   | Propósito                                                              |
| :----------------------- | :------------------------------------------ | :---------------------------------------- | :--------------------------------------------------------------------- |
| **EditorConfig**         | [`.editorconfig`](../.editorconfig)         | Automático en IDE                         | Consistencia de UTF-8, LF, indentación de 2 espacios (4 en SQL).       |
| **ESLint (Flat Config)** | [`eslint.config.mjs`](../eslint.config.mjs) | `npm run lint` / `npm run lint:fix`       | Análisis estático para TypeScript/ESM y prevención de errores comunes. |
| **Prettier**             | [`.prettierrc`](../.prettierrc)             | `npm run format` / `npm run format:check` | Formateo automático determinista (comillas dobles, `;`, 100 columnas). |
| **TypeScript**           | [`tsconfig.json`](../tsconfig.json)         | `npm run build`                           | Verificación de tipos (`tsc --noEmit`).                                |

---

## 2. Convenciones de TypeScript y ESM

1. **Extensiones `.js` en imports relativos:** Al usar `"type": "module"` y `"moduleResolution": "NodeNext"`, todo import relativo entre módulos TypeScript **debe** incluir la extensión `.js` (ej. `import { config } from "../config/index.js";`).
2. **Tipado explícito:**
   - Evitar introducir nuevos usos de `any`; preferir `unknown` en bloques `catch` y narrowing seguro.
   - Definir contratos compartidos en [`src/types/index.ts`](../src/types/index.ts).
3. **Nombres e Idioma:**
   - **Dominio y funciones de negocio:** `camelCase` descriptivo en español coherente con el código existente (`procesarYGuardarReporte`, `obtenerHojaDeCalculo`, `ejecutarConReintento`).
   - **Tipos e Interfaces:** `PascalCase` (`ReporteParseado`, `ResultadoProcesamiento`, `RetryOptions`).
   - **Constantes globales:** `UPPER_SNAKE_CASE` (`COLUMNAS`, `REGEX_ELIMINAR`).
   - **Variables no usadas intencionalmente:** Prefijar con `_` (ej. `_err`, `_unused`).

---

## 3. Reglas de Resiliencia y Concurrencia

- **Exclusión mutua en Google Sheets:** Toda operación de escritura o secuencia lectura-escritura sobre `registros_telegram` debe ejecutarse dentro de `sheetsMutex.runExclusive(...)` (`src/utils/mutex.ts`).
- **Reintentos en llamadas externas:** Envolver llamadas a Google Sheets (`loadInfo`, `loadHeaderRow`, `setHeaderRow`, `getRows`, `save`, `addRow`) con `ejecutarConReintento` (`src/utils/retry.ts`).
- **Cero excepciones no controladas en handlers:** `src/handlers/message.ts` y `src/handlers/commands.ts` deben capturar errores localmente, responder con un aviso claro al usuario y nunca propagar errores no controlados que afecten el ciclo de polling.
- **Contención por fila en batch jobs:** En bucles de limpieza (`src/jobs/cleanup.ts`), envolver cada iteración en `try/catch` para que el fallo de una fila no aborte el lote.

---

## 4. Logging y Seguridad

- No imprimir credenciales, llaves privadas ni objetos `AxiosError` crudos completos que contengan cabeceras `Authorization: Bearer ...` (imprimir `error?.message ?? error` o usar redacción).
- Mantener la zona horaria oficial `America/Caracas` mediante `config.app.timezone` y utilidades de [`src/utils/dateUtils.ts`](../src/utils/dateUtils.ts).

---

## 5. Pruebas Automatizadas

- Runner nativo de Node.js ejecutado con `tsx --test` (`npm test`).
- Ubicar pruebas en `tests/*.test.ts` y helpers/mocks en `tests/helpers/`.
- Para simular Google Sheets sin monkeypatching ESM, utilizar `setHojaDeCalculoProviderForTesting` (`src/services/sheets.ts`) y restaurarlo a `null` en `afterEach`.
