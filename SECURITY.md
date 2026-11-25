# 🛡️ Política de Seguridad y Plan de Endurecimiento

Este documento detalla los controles de seguridad implementados actualmente en `bot-telegram-campo`, el modelo de control de acceso (RBAC), la gestión de secretos y el plan de endurecimiento recomendado para producción.

---

## 1. Controles de Seguridad Actuales

### 1.1 Autenticación y Control de Acceso (RBAC)

- **Comandos administrativos (`/reporte`, `/lista`, `/estado`, `/actualizar`):** Protegidos mediante `esUsuarioAdmin(ctx)` en [`src/utils/telegram.ts`](src/utils/telegram.ts):
  - **En chats grupales:** Consulta en tiempo real `ctx.getChatMember(ctx.from.id)` y exige rol `administrator` o `creator` (o `GroupAnonymousBot` con ID `1087968824`).
  - **En chats privados:** Exige pertenencia explícita a la lista blanca `TELEGRAM_MANAGER_CHAT_ID` (`config.telegram.managerChatIds`).
- **Aislamiento de credenciales externas:**
  - Google Sheets utiliza cuenta de servicio JWT limitada al scope `https://www.googleapis.com/auth/spreadsheets`.
  - Supabase desactiva sesiones de navegador (`persistSession: false`, `autoRefreshToken: false`, `detectSessionInUrl: false`).

### 1.2 Seguridad de Contenedor y Runtime

- **Usuario sin privilegios:** El [`Dockerfile`](Dockerfile) ejecuta el proceso bajo `USER node` (no-root) sobre `node:22-alpine`.
- **Separación de secretos:** El archivo `.env` está listado en `.gitignore` y `.dockerignore`; en [`docker-compose.yml`](docker-compose.yml) se inyecta en runtime vía `env_file`.
- **Rotación de logs:** `docker-compose.yml` limita logs a `10m` x `5` archivos para mitigar agotamiento de disco (DoS local).
- **Estabilidad del proceso:** `bot.ts` registra manejadores globales (`unhandledRejection`, `uncaughtException`, `bot.catch`) y apagado limpio ante `SIGINT`/`SIGTERM`.
- **Protección contra denegación de servicio / cuota:** `src/utils/retry.ts` limita reintentos (`maxIntentos: 3`) con backoff exponencial + jitter; `src/jobs/cleanup.ts` aplica pausas (`cleanupRequestDelayMs: 500`) y límite de filas por barrido (`60`).

### 1.3 Integridad y Trazabilidad de Datos

- **Validación de entrada:** Todo reporte pasa por regex estrictas (`parsearReporte`), validación de ventana laboral, verificación contra catálogo oficial y control de límite máximo de verificadores.
- **Auditoría:** Cada creación o edición persistida en PostgreSQL genera un registro en `logs_auditoria` con `telegram_chat_id`, `telegram_message_id`, `remitente`, `accion` y `detalles` en `JSONB`.

---

## 2. Brechas Identificadas y Plan de Endurecimiento para Producción

Las siguientes observaciones surgen de la auditoría directa del código actual y conforman la hoja de ruta de endurecimiento:

| Prioridad | Hallazgo Real en Código                                                                                                           | Riesgo                                                                                                                                   | Acción de Endurecimiento Recomendada                                                                                                                               |
| :-------- | :-------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Resuelto** | **Chat ID de respaldo hardcodeado** (eliminado de `src/services/notifications.ts` y `src/services/reporting.ts`).              | Envío accidental de reportes a un grupo equivocado si falta `TELEGRAM_REPORT_CHAT_ID` en un entorno nuevo/staging.                       | Mitigado: ahora requiere `TELEGRAM_REPORT_CHAT_ID` o el `ID Chat` registrado en la hoja; omite el envío con advertencia si no existe.                              |
| **Alta**  | **Ausencia de lista blanca de grupos para ingesta de reportes** en `src/handlers/message.ts`.                                     | Si el bot es agregado a un grupo no autorizado, procesaría mensajes que contengan `Formato de reporte`.                                  | Validar `ctx.chat.id` contra una variable `TELEGRAM_ALLOWED_CHAT_IDS` antes de procesar mensajes de texto/ediciones.                                               |
| **Alta**  | **Políticas RLS y uso de `DATABASE_KEY` en Supabase.**                                                                            | Si se usa la `service_role` key, cualquier consulta omite Row Level Security; si se filtra, expone toda la BD.                           | Asegurar que RLS esté habilitado en `nodos_catalogo`, `reportes_diarios` y `logs_auditoria` bloqueando acceso `anon`, y rotar periódicamente la clave de servicio. |
| **Media** | **Logging con `console.log`/`console.error` sin redacción automática** (aunque `pino` está en `package.json`, no se utiliza aún). | En errores HTTP (como `AxiosError`), imprimir el objeto completo puede exponer cabeceras `Authorization: Bearer ...` en logs de consola. | Migrar a `pino` con configuración `redact` para ocultar `*.headers.Authorization`, `*.config.headers.Authorization` y tokens antes de escribir logs.               |
| **Media** | **`strict: false` en `tsconfig.json` y uso de `any`.**                                                                            | Reduce garantías de seguridad de tipos en fronteras de entrada externa.                                                                  | Migrar gradualmente a `strict: true` empezando por `src/utils/` y `src/services/`.                                                                                 |
| **Baja**  | **Dependencias y auditoría SCA.**                                                                                                 | Vulnerabilidades transitivas en paquetes npm (`axios`, `google-spreadsheet`, etc.).                                                      | Ejecutar `npm audit` en CI y fijar `npm ci --omit=dev` en el `Dockerfile` de producción (actualmente usa `npm ci` completo).                                       |

---

## 3. Reporte de Vulnerabilidades y Gestión de Secretos

- **Nunca commitear** archivos `.env`, llaves privadas JSON de Google Cloud ni dumps de logs con cabeceras `Authorization`.
- **En caso de exposición de credenciales:**
  1. Revocar inmediatamente el token en `@BotFather` (`/revoke`).
  2. Eliminar y regenerar la clave privada de la cuenta de servicio en Google Cloud IAM.
  3. Rotar `DATABASE_KEY` en el panel de Supabase.
  4. Actualizar las variables de entorno en Render / servidor Docker y reiniciar el contenedor.
