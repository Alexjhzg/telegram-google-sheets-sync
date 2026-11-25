# 📄 Documento de Requerimientos de Producto (PRD)

**Producto:** Bot de Telegram para Supervisión de Personal en Campo (`bot-telegram-campo`)  
**Ámbito Operativo:** Estado Monagas (Encuestadores / Verificadores SEGEN)  
**Versión:** 1.0.0  
**Estado:** En producción

---

## 1. Visión y Propósito del Producto

El sistema automatiza la recolección, validación, acumulación por turnos y consolidación en tiempo real de los reportes de asistencia de personal de campo (verificadores) enviados por supervisores en grupos de Telegram.

El bot elimina el consolidado manual de mensajes, aplica reglas estrictas de integridad sobre horarios y cupos por nodo, persiste los datos de forma dual (**PostgreSQL/Supabase** + **Google Sheets**) y genera reportes gerenciales automáticos en cada corte de la jornada laboral.

---

## 2. Usuarios y Personas

| Rol / Persona                    | Canal de Interacción                                  | Necesidad Principal                                                                                                                                                               |
| :------------------------------- | :---------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Supervisor de Campo**          | Grupo de Telegram                                     | Enviar y corregir reportes diarios por municipio y nodo recibiendo confirmación inmediata (`👍`/`👎`) y retroalimentación clara ante errores.                                     |
| **Administrador de Grupo**       | Grupo de Telegram                                     | Consultar el estado operativo en vivo (`/reporte`, `/lista`, `/estado`) y forzar la sincronización del catálogo oficial (`/actualizar`).                                          |
| **Gerencia / Encargados**        | Chat privado de Telegram (`TELEGRAM_MANAGER_CHAT_ID`) | Recibir automáticamente los resúmenes consolidados de porcentajes por corte y el desglose de nodos faltantes al cierre del día.                                                   |
| **Operador / Analista de Datos** | Google Sheets y Supabase                              | Visualizar en tiempo real la hoja `registros_telegram`, mantener el catálogo `verificadores_nodo` y consultar históricos (`registros_historicos_telegram`, `nodos_sin_reportes`). |

---

## 3. Requerimientos Funcionales (RF)

| ID        | Requerimiento                                                                                                                                                                                                                                                                                                              | Implementación Real                                                                                           |
| :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| **RF-01** | **Ingesta y parseo de reportes:** Detectar mensajes y ediciones que contengan la palabra clave `Formato de reporte` y extraer Municipio, Nodo, Total de Verificadores y Bloques (`9am`, `2pm`, `6pm`).                                                                                                                     | `src/handlers/message.ts`, `src/utils/parser.ts` (`parsearReporte`)                                           |
| **RF-02** | **Control de jornada laboral (VET):** Aceptar reportes y ediciones únicamente dentro de la ventana laboral configurada (`06:00` – `18:00` `America/Caracas`). Rechazar con alerta los reportes fuera de horario.                                                                                                           | `src/utils/parser.ts` (`obtenerBloqueYHoraActivo`), `src/handlers/message.ts`                                 |
| **RF-03** | **Validación contra catálogo oficial:** Verificar que el Municipio y Nodo existan y que la suma acumulada (`B1 + B2 + B3`) no supere el `limite_verificadores` / `CANTIDAD DE VERIFICADORES`.                                                                                                                              | `src/services/database.ts` (`validarMunicipioNodoDB`), `src/services/validation.ts` (`validarMunicipioNodo`)  |
| **RF-04** | **Acumulación por bloques y regla de pasado bloqueado:** Proteger bloques cerrados (solo lectura), derivar diferenciales positivos tardíos al bloque activo y permitir actualización libre en el bloque presente/futuro.                                                                                                   | `src/utils/accumulation.ts` (`calcularAcumulacion`), `src/services/reportProcessor.ts`                        |
| **RF-05** | **Ediciones, holgura y revisión:** Aplicar ventana de gracia de `10` minutos (`REPORT_EDIT_GRACE_PERIOD_MINS`) para mantener la hora original de creación; marcar filas editadas inválidas como `Revisión desde: <ISO>` por 5 minutos antes de resetearlas.                                                                | `src/handlers/message.ts`, `src/services/reportProcessor.ts`, `src/jobs/cleanup.ts`                           |
| **RF-06** | **Eliminación de reportes:** Permitir resetear una fila a cero y borrar el mensaje si el texto contiene palabras clave de eliminación (`eliminar`, `borrar`, `eliminado`, `borrado`).                                                                                                                                      | `src/handlers/message.ts` (`manejarEliminacion`), `src/services/reportProcessor.ts` (`eliminarReporte`)       |
| **RF-07** | **Persistencia dual resiliente:** Guardar reportes en PostgreSQL/Supabase (`reportes_diarios` + `logs_auditoria`) y actualizar la fila fija en `registros_telegram` con reintentos exponenciales ante errores transitorios (`503`, `429`, etc.) y degradación elegante si Sheets falla.                                    | `src/services/reportProcessor.ts`, `src/services/database.ts`, `src/services/sheets.ts`, `src/utils/retry.ts` |
| **RF-08** | **Comandos administrativos:** Proveer `/reporte`, `/lista`, `/estado` y `/actualizar` restringidos a administradores del grupo o `TELEGRAM_MANAGER_CHAT_ID` en privado.                                                                                                                                                    | `src/handlers/commands.ts`, `src/utils/telegram.ts` (`esUsuarioAdmin`)                                        |
| **RF-09** | **Automatización programada (Croner):** Ejecutar limpieza periódica cada 5 min, sincronización de catálogo cada 15 min, avisos de cierre (`9:00`, `14:00`, `18:00`), reportes consolidados (`9:05`, `14:05`, `18:05`), alerta de nodos faltantes (`18:06`), resguardo histórico (`23:00`) y reset de medianoche (`00:00`). | `src/jobs/cleanup.ts` (`programarLimpieza`), `src/services/reporting.ts`, `src/services/notifications.ts`     |
| **RF-10** | **Healthcheck HTTP:** Exponer `GET /` y `GET /healthz` para monitoreo de disponibilidad y keep-alive en Render / Docker.                                                                                                                                                                                                   | `bot.ts`                                                                                                      |

---

## 4. Requerimientos No Funcionales (RNF)

| Categoría          | Requerimiento                                                                                                                                    | Estado Actual                                                                                                           |
| :----------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| **Concurrencia**   | Evitar condiciones de carrera al leer/escribir filas en Google Sheets mediante exclusión mutua reentrante.                                       | Implementado (`src/utils/mutex.ts` con `AsyncLocalStorage`).                                                            |
| **Resiliencia**    | Tolerar caídas transitorias de Google Sheets API (`503`, `502`, `504`, `429`, errores de red) sin caídas del proceso ni rechazos no controlados. | Implementado (`src/utils/retry.ts`, degradación elegante en `reportProcessor.ts`, contención por fila en `cleanup.ts`). |
| **Disponibilidad** | Arranque limpio, manejo de conflicto `409` en polling de Telegram y apagado ordenado ante `SIGTERM`/`SIGINT`.                                    | Implementado en `bot.ts` y `docker-compose.yml`.                                                                        |
| **Zona Horaria**   | Todas las ventanas laborales, cortes y fechas deben evaluarse en `America/Caracas` (VET).                                                        | Implementado (`config.app.timezone`).                                                                                   |
| **Trazabilidad**   | Registrar auditoría de operaciones de reportes en PostgreSQL (`logs_auditoria`) y logs de consola.                                               | Implementado (`registrarAuditoriaDB` y `console.*`).                                                                    |

---

## 5. Fuera de Alcance (Out of Scope)

- Interfaz web (dashboard frontend, panel web administrativo o autenticación por navegador).
- Gestión de usuarios o permisos mediante base de datos propia (se delega a roles de grupo de Telegram y `TELEGRAM_MANAGER_CHAT_ID`).
- Soporte multi-estado o multi-tenant (los reportes consolidados actuales están configurados para el estado **Monagas**).

---

## 6. Criterios de Éxito y Métricas Operativas

- **0% de pérdida de reportes válidos** ante indisponibilidad temporal de Google Sheets cuando Supabase está activo (`persistidoDB = true`).
- **100% de consistencia** entre el catálogo oficial `verificadores_nodo` y `nodos_catalogo` tras cada ciclo de sincronización de 15 minutos o ejecución de `/actualizar`.
- **Cobertura de pruebas automatizadas** en verde (`npm test`) para parseo, fechas, catálogo, base de datos, limpieza y escenarios de error 503.
