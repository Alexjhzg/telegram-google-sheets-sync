# 🎨 Design System y Guía de Experiencia Conversacional (Telegram UI)

> **Nota de veracidad arquitectónica:** Este repositorio corresponde exclusivamente a un **bot backend de Telegram** (Node.js + TypeScript + Grammy). **No existe interfaz web (HTML/CSS/React/Vue)** ni tokens visuales de navegador. Por lo tanto, el Design System del proyecto define los **estándares de interfaz conversacional en Telegram**: formato Markdown, semántica de emojis, reacciones, tablas monoespaciadas y tono de mensajes.

---

## 1. Principios de Diseño Conversacional

1. **Confirmación inmediata sin ruido:** Los reportes válidos se confirman únicamente con una reacción (`👍`), evitando saturar el chat grupal con mensajes innecesarios.
2. **Errores accionables:** Todo rechazo (`👎`) responde directamente al mensaje original (`reply_parameters: { message_id }`), explica **qué falló**, **por qué** y **cómo corregirlo** (editando o reenviando).
3. **Escaneabilidad móvil:** Los reportes a gerencia y comandos administrativos priorizan encabezados en negrita (`*Título*`), viñetas (`•`), bloques de código monoespaciado (`` `valor` ``) y separadores visuales claros.
4. **Resiliencia transparente:** Ante fallos externos (como HTTP `503` en Google Sheets), el usuario recibe un aviso claro en lenguaje natural, nunca stack traces ni códigos internos crudos.

---

## 2. Semántica de Reacciones y Emojis (Tokens Conversacionales)

Todos los emojis están estandarizados en [`src/handlers/message.ts`](../src/handlers/message.ts), [`src/handlers/commands.ts`](../src/handlers/commands.ts), [`src/services/reporting.ts`](../src/services/reporting.ts) y [`src/services/notifications.ts`](../src/services/notifications.ts):

### 2.1 Reacciones de Mensaje (`ctx.react`)

| Reacción | Significado                   | Cuándo se aplica                                                                                                                    |
| :------- | :---------------------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| `👍`     | Reporte aceptado y persistido | Reporte válido guardado en Sheets (o en BD con sincronización diferida).                                                            |
| `👎`     | Reporte o edición rechazada   | Fuera de jornada laboral, formato inválido, municipio/nodo no reconocido, exceso de verificadores o error de conexión sin respaldo. |

### 2.2 Iconografía Semántica en Mensajes

| Emoji       | Categoría                  | Uso Oficial                                                                                    |
| :---------- | :------------------------- | :--------------------------------------------------------------------------------------------- |
| `⚠️`        | Advertencia / Rechazo      | Encabezados de rechazo de reporte, alertas de nodos sin reporte o fallos parciales.            |
| `❌`        | Error / Ausencia           | Fallo de comando, estado desconectado o etiqueta `(Sin reporte ❌)` en desglose de faltantes.  |
| `✅`        | Éxito / Completado         | Conexión activa en `/estado`, sincronización exitosa en `/actualizar`, salida a campo al 100%. |
| `ℹ️`        | Informativo                | Aviso de reporte resguardado en BD (sincronización diferida) y leyenda de simbología.          |
| `🔴` / `🟢` | Estado de Bloque / Horario | `🔴` Corte cerrado o jornada cerrada; `🟢` Bloque activo o jornada abierta.                    |
| `🏁`        | Cierre de Jornada          | Cierre definitivo del corte de las 6:00 PM.                                                    |
| `📍`        | Ubicación Geográfica       | Encabezado de municipio en desgloses y alertas de faltantes.                                   |
| `📉`        | Cobertura Parcial          | Etiqueta `(Reportó X/Y 📉)` cuando el nodo no alcanza su límite de verificadores.              |
| `📊`        | Resumen / Métricas         | Encabezado del desglose de faltantes por municipio y nodo.                                     |
| `⛔`        | Acceso Denegado            | Usuario sin permisos de administrador intentando ejecutar `/reporte` o `/actualizar`.          |
| `🔄`        | Proceso en Curso           | Inicio de sincronización manual del catálogo (`/actualizar`).                                  |
| `👉`        | Llamada a la Acción (CTA)  | Indicación de cómo corregir un reporte o ejemplo de formato correcto.                          |

---

## 3. Tipografía y Formato Markdown (Telegram Legacy `parse_mode: "Markdown"`)

| Elemento                   | Sintaxis Telegram        | Uso                                                                                    |
| :------------------------- | :----------------------- | :------------------------------------------------------------------------------------- |
| **Encabezado / Énfasis**   | `*Texto*`                | Títulos de alertas, nombres de municipios, nombres de remitentes y totales destacados. |
| **Dato técnico / Métrica** | `` `valor` ``            | Horas VET, límites numéricos, contadores de nodos, uptime y memoria.                   |
| **Nota secundaria**        | `_Texto_`                | Pie de mensaje informativo (ej. `_Estaremos registrando estas incidencias._`).         |
| **Tabla de ancho fijo**    | ` ``` ... ``` `          | Desglose tabular del comando `/lista` (`Mun                                            | Nodo | 9a  | 2p  | 6p  | Tot`, columnas con `padEnd`/`padStart`). |
| **Separador visual**       | `━━━━━━━━━━━━━━━━━━━━━━` | División entre el encabezado de métricas del estado y el listado por municipio.        |

> **Regla de seguridad de formato:** Al usar `parse_mode: "Markdown"` en Telegram, evitar caracteres `_`, `*`, `` ` `` o `[` sin escapar en cadenas dinámicas externas que puedan romper el renderizado de la API de Telegram.

---

## 4. Plantillas Canónicas de Mensajes

### 4.1 Formato de Entrada Esperado (Supervisores)

```text
Formato de reporte
1. Municipio: Punceres
2. Nodo: 16039
3. Total de Verificadores en el nodo: 1
➡️Bloque (1) 9am: 0
➡️Bloque (2) 2pm: 0
➡️Bloque (3) 6pm: 1
```

### 4.2 Estructura de Alerta de Rechazo

```markdown
⚠️ _Reporte Rechazado: [Motivo]_

Hola _[Remitente]_, [explicación concisa del problema].

• _[Detalle clave 1]:_ `valor`
• _[Detalle clave 2]:_ `valor`

👉 _¿Cómo solucionarlo?_ [Acción concreta para el supervisor].
```

### 4.3 Estructura de Reporte Consolidado Diario

```markdown
_[Día] [DD/MM/YYYY]_

_Monagas_
Reporte de Encuestadores SEGEN en campo:

• 9:00 am X/Y = XX,XX%
• 2:00 pm X/Y = XX,XX%
• 6:00 pm X/Y = XX,XX%

_Acumulado campo:_ Z/Y = _ZZ,ZZ%_
```
