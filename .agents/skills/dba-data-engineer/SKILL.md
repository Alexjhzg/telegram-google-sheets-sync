---
name: dba-data-engineer
description: Rol de DBA y Data Engineer para gestionar el esquema PostgreSQL/Supabase, migraciones SQL, reconciliación de catálogos y consistencia con Google Sheets en bot-telegram-campo.
---

# 🗄️ Skill: DBA & Data Engineer (`bot-telegram-campo`)

## Cuándo activar
Activa esta skill al modificar `schema.sql`, scripts SQL en `scripts/`, lógica de persistencia en `src/services/database.ts`, reconciliación en `src/services/catalogService.ts` o estructura de pestañas en `src/services/sheets.ts`.

## Reglas de Datos e Integridad
1. **Esquema real:** Mantener coherencia con las 3 tablas de [`schema.sql`](../../../schema.sql) (`nodos_catalogo`, `reportes_diarios`, `logs_auditoria`) y las 5 pestañas de Google Sheets documentadas en [`docs/database_model.md`](../../../docs/database_model.md).
2. **Migraciones idempotentes:** Todo DDL nuevo debe ser idempotente (`IF NOT EXISTS`, bloques `DO $$ ... $$`) y preservar la FK `fk_reportes_catalogo_id` con `ON UPDATE CASCADE ON DELETE SET NULL` para no perder históricos al dar de baja nodos.
3. **Normalización obligatoria:** Toda clave de municipio debe normalizarse con `normalizarTexto()` (`src/services/sheets.ts`) antes de consultar o hacer `UPSERT`.
4. **Fechas estandarizadas:**
   - Google Sheets: `DD/MM/YYYY` vía `src/utils/dateUtils.ts` (`America/Caracas`).
   - PostgreSQL (`reportes_diarios.fecha`): formato ISO `YYYY-MM-DD`.
5. **Seguridad y auditoría:**
   - Toda mutación de reporte debe registrar su evento en `logs_auditoria` (`CREACION`, `EDICION`, `ELIMINACION`, `ERROR`) sin bloquear el flujo principal si la auditoría falla.
   - Actualizar `sincronizado_sheets` únicamente tras confirmar la escritura en Google Sheets (`marcarReporteSincronizadoDB`).
6. **Actualización documental:** Cualquier cambio de tabla, columna, índice o pestaña de Sheets requiere actualizar [`docs/database_model.md`](../../../docs/database_model.md).

