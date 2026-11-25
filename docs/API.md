# 🔌 Contratos de API, Comandos e Integraciones

Este documento especifica las interfaces reales expuestas y consumidas por `bot-telegram-campo`:

1. **API HTTP interna** (Healthcheck / Keep-Alive en `bot.ts`).
2. **Interfaz de Comandos de Telegram** (`src/handlers/commands.ts`).
3. **Contrato de Mensajes y Ediciones de Telegram** (`src/handlers/message.ts`).
4. **Integraciones con APIs Externas** (Telegram Bot API, Google Sheets API v4, Supabase PostgREST).

---

## 1. Endpoints HTTP (`bot.ts`)

El servidor HTTP nativo (`node:http`) escucha en `0.0.0.0:${PORT || 8080}`.

### `GET /` y `GET /healthz`

Verifica que el proceso del bot se encuentre activo (requerido para Render Web Services y healthchecks de contenedor).

- **Autenticación:** Ninguna (público).
- **Respuesta `200 OK` (`application/json`):**

```json
{
  "status": "ok",
  "uptime": 3600,
  "message": "Bot de supervisión en campo activo y escuchando."
}
```

### Cualquier otra ruta

- **Respuesta `404 Not Found` (`text/plain`):** `Not Found`

---

## 2. Comandos Administrativos de Telegram (`src/handlers/commands.ts`)

Todos los comandos validan autorización mediante `esUsuarioAdmin(ctx)` (`src/utils/telegram.ts`):

- **En grupos:** `chatMember.status` es `"administrator"` o `"creator"`, o remitente `GroupAnonymousBot` (`ID: 1087968824`).
- **En chats privados:** `ctx.from.id` debe pertenecer a `config.telegram.managerChatIds` (`TELEGRAM_MANAGER_CHAT_ID`).

| Comando       | Descripción                                                                                                                                                 | Fuente de Datos                                               | Respuesta                                               | Si no es Admin                                  |
| :------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------ | :------------------------------------------------------ | :---------------------------------------------- |
| `/reporte`    | Genera el consolidado del estado Monagas en tiempo real (porcentajes del corte activo, desglose de faltantes y leyenda).                                    | `formato_reporte`, `verificadores_nodo`, `registros_telegram` | 3 mensajes Markdown (`generarReporteRealTime`)          | Responde `⛔ No tienes permisos autorizados...` |
| `/lista`      | Muestra una tabla monoespaciada con los nodos que tienen reportes con fecha de hoy (`Mun \|Nodo \|9a\|2p\|6p\|Tot`).                                        | `registros_telegram`                                          | 1 mensaje Markdown con bloque ` ``` `                   | Ignora silenciosamente                          |
| `/estado`     | Diagnóstico operativo: conectividad con Google Sheets, conteo de nodos reportados hoy, estado del horario laboral, uptime, memoria heap y hora oficial VET. | `registros_telegram` + `process`                              | 1 mensaje Markdown                                      | Ignora silenciosamente                          |
| `/actualizar` | Ejecuta la sincronización manual del catálogo `verificadores_nodo` (Sheets) hacia `nodos_catalogo` (PostgreSQL).                                            | `verificadores_nodo` → Supabase                               | Aviso `🔄` + resumen `✅` (guardados/eliminados) o `⚠️` | Responde `⛔ No tienes permisos autorizados...` |

---

## 3. Contrato de Mensajes de Campo (`src/handlers/message.ts`)

El bot escucha los eventos `message:text` y `edited_message:text`.

### 3.1 Contrato de Reporte Válido

Debe contener la palabra clave `Formato de reporte` (insensible a mayúsculas) y los campos `Municipio` y `Nodo` (parseados por `parsearReporte` en `src/utils/parser.ts`).

| Campo                   | Regex / Regla                                                                           | Obligatorio            |
| :---------------------- | :-------------------------------------------------------------------------------------- | :--------------------- |
| **Municipio**           | `/(?:Municipio\|municipio)\*?\s*:\*?\s*([^*️\r\n\t]+)/i`                                 | Sí                     |
| **Nodo**                | `/(?:Nodo\|nodo)\*?\s*:\*?\s*(\d+)/i`                                                   | Sí                     |
| **Total Verificadores** | `/(?:Total\s*(?:de)?\s*Verificadores(?:\s*en\s*el\s*nodo)?)\*?\s*:\*?\s*(\d+)/i`        | No (default `0`)       |
| **Bloque 1 (9am)**      | `/9\s*(?:a\.?m\.?\|p\.?m\.?)\*?\s*[:\-=\s]?\*?\s*[\(\[\{]?\s*[,.]?\s*(\d+)?[\)\]\}]?/i` | No (`null` si ausente) |
| **Bloque 2 (2pm)**      | `/2\s*(?:a\.?m\.?\|p\.?m\.?)\*?\s*[:\-=\s]?\*?\s*[\(\[\{]?\s*[,.]?\s*(\d+)?[\)\]\}]?/i` | No (`null` si ausente) |
| **Bloque 3 (6pm)**      | `/6\s*(?:a\.?m\.?\|p\.?m\.?)\*?\s*[:\-=\s]?\*?\s*[\(\[\{]?\s*[,.]?\s*(\d+)?[\)\]\}]?/i` | No (`null` si ausente) |

### 3.2 Códigos de Resultado Interno (`ResultadoProcesamiento.razon`)

| Código `razon`              | Significado                                                                          | Acción en Telegram                                        |
| :-------------------------- | :----------------------------------------------------------------------------------- | :-------------------------------------------------------- |
| _(ausente, `valido: true`)_ | Procesado correctamente. Si `sincronizadoSheets === false`, quedó resguardado en BD. | Reacción `👍` (+ aviso `ℹ️` si sincronización diferida).  |
| `FUERA_DE_HORARIO`          | Mensaje/edición fuera de `06:00` – `18:00` VET.                                      | Reacción `👎` + aviso de horario laboral.                 |
| `MUNICIPIO_INCORRECTO`      | Municipio no existe en catálogo oficial.                                             | Reacción `👎` + alerta con ejemplos válidos.              |
| `NODO_INCORRECTO`           | Nodo no pertenece al municipio en catálogo oficial.                                  | Reacción `👎` + alerta de nodo no reconocido.             |
| `EXCESO_VERIFICADORES`      | `b1Final + b2Final + b3Final > limiteVerificadores`.                                 | Reacción `👎` + alerta con límite y suma proyectada.      |
| `ERROR_CONEXION_SHEETS`     | Google Sheets falló tras reintentos y no hubo persistencia en BD.                    | Reacción `👎` + aviso de indisponibilidad temporal (503). |

### 3.3 Contrato de Eliminación por Palabra Clave

- Si un mensaje o edición dentro de jornada laboral coincide con `/\b(?:eliminar|borrar|eliminado|borrado)\b/i`, el bot ejecuta `eliminarReporte(messageId)` (resetea a `0` la fila en `registros_telegram`) e intenta eliminar el mensaje con `ctx.deleteMessage()`.

---

## 4. Integraciones con APIs Externas

| Servicio Externo          | Librería / Cliente                                                  | Autenticación                                                                                     | Estrategia de Resiliencia                                                                                                                           |
| :------------------------ | :------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Telegram Bot API**      | `grammy` (`^1.27.0`)                                                | `TELEGRAM_BOT_TOKEN`                                                                              | Reintento automático ante conflicto `409` (10s) y otros errores de polling (5s) en `bot.ts`; manejo aislado de `sendMessage` por destinatario.      |
| **Google Sheets API v4**  | `google-spreadsheet` (`^4.1.4`) + `google-auth-library` (`^9.11.0`) | JWT Service Account (`GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY`, scope `spreadsheets`) | `sheetsMutex` global reentrante + `ejecutarConReintento` (backoff exponencial + jitter para `503`, `502`, `504`, `429`, `408` y errores de socket). |
| **Supabase / PostgreSQL** | `@supabase/supabase-js` (`^2.45.4`)                                 | `DATABASE_URL` + `DATABASE_KEY` (service role / API key, `persistSession: false`)                 | Fallback a validación contra Google Sheets si falla consulta a BD; captura de errores en auditoría para no bloquear el flujo principal.             |
