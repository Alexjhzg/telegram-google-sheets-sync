# 🤖 Telegram & Google Sheets Real-Time Synchronizer

[![Node.js](https://img.shields.io/badge/Node.js-v20+-green.svg?style=for-the-badge&logo=node.js)](https://nodejs.org/)
[![GrammY](https://img.shields.io/badge/GrammY-v1+-blue.svg?style=for-the-badge&logo=telegram)](https://grammy.dev/)
[![Google Sheets API](https://img.shields.io/badge/Google%20Sheets-API-red.svg?style=for-the-badge&logo=google-sheets)](https://developers.google.com/sheets/api)
[![Docker](https://img.shields.io/badge/Docker-Enabled-blue.svg?style=for-the-badge&logo=docker)](https://www.docker.com/)

Un bot de Telegram empresarial e inteligente diseñado para la **supervisión de personal y reporte de novedades en campo en tiempo real** (verificadores) en el estado Monagas. El sistema extrae datos de reportes mediante expresiones regulares y los sincroniza de forma segura en una hoja de cálculo unificada de Google Sheets estructurada con **filas fijas por nodo**.

El bot incluye un **Background Worker** que realiza la reconciliación continua de los mensajes (eliminando o reseteando los datos de filas si el mensaje original fue borrado de Telegram) y un potente panel de comandos de diagnóstico reservado para administradores.

---

## 🚀 Características Principales

* 📊 **Arquitectura de Filas Fijas:** A diferencia de las inserciones dinámicas de filas, el bot trabaja sobre una estructura de nodos pre-poblada desde un catálogo oficial. El sistema actualiza campos de celdas específicas en lugar de crear nuevas filas.
* 🧹 **Saneamiento Automático:** Worker en segundo plano (cada 5 minutos) que verifica si los mensajes de reportes registrados han sido borrados de Telegram. Si se elimina el mensaje, la fila del nodo correspondiente restablece sus valores a cero.
* ⚙️ **Comandos Administrativos de Monitoreo:**
  * `/reporte` — Genera un consolidado de asistencia del estado en tiempo real.
  * `/lista` — Devuelve un desglose tabular nodo por nodo (B1, B2, B3 y total) para el día en curso.
  * `/estado` — Diagnóstico de salud del sistema (conexión con la API de Sheets, uptime, memoria, hora oficial VET, estado de ventana de la jornada laboral).
* ⏱️ **Lógica de Turnos y Bloques Rígidos:** Jornada organizada en 3 cortes horarios basados en la zona horaria nativa de Venezuela (`America/Caracas`):
  * **Bloque 1 (B1):** 9:00 AM
  * **Bloque 2 (B2):** 2:00 PM
  * **Bloque 3 (B3):** 6:00 PM
* 🛡️ **Seguridad y Control de Edición:**
  * Restricción estricta de comandos administrativos solo a administradores o creadores del grupo de Telegram.
  * Ventana de gracia de 10 minutos para re-procesar ediciones usando la fecha original de envío.
  * Gestión de estados de error mediante reacciones (`👍` / `👎`) y respuestas con alertas contextuales detalladas (error de municipio, nodo inválido, o exceso de capacidad).
  * Marcado temporal de filas inválidas en Google Sheets (`Estado: Revisión desde [Timestamp]`) antes de su purga definitiva tras 5 minutos sin corrección.

---

## 🛠️ Arquitectura de la Solución

### Flujo de Reportes en Tiempo Real

```mermaid
graph TD
    A[Mensaje o Edición en Telegram] -->|1. Validación Horaria| B{¿Entre 6:00 AM y 6:00 PM VET?}
    B -->|No| C[Ignorar silenciosamente]
    B -->|Sí| D{¿Contiene 'Formato de reporte'?}
    D -->|No| E[Ignorar / Poner en revisión si es edición]
    D -->|Sí| F[Parseo Regex: Municipio, Nodo y Bloques]
    F -->|Fallo Parsing| G[Reaccionar 👎 + Alerta de Formato]
    F -->|Éxito| H[Validar Municipio y Nodo vs Catálogo]
    H -->|No existe en catálogo| I[Reaccionar 👎 + Alerta de Catálogo]
    H -->|Existe| J[Validar Límite de Capacidad Máxima]
    J -->|Excede límite permitido| K[Reaccionar 👎 + Alerta de Capacidad]
    J -->|Aprobado| L[Calcular Bloques Horarios Pasado/Presente]
    L --> M[Actualizar Fila Fija del Nodo en registros_telegram]
    M --> N[Reaccionar 👍 en Telegram]
```

### Flujo de Reconciliación del Worker (Segundo Plano)

```mermaid
graph TD
    A[Croner Scheduler: Cada 5 min] -->|1. Consultar últimas 60 filas| B[Google Sheets]
    B -->|2. Obtener IDs de Mensaje| C{¿Mensaje existe en Telegram?}
    C -->|Sí| D{¿Está en estado de revisión > 5 min?}
    D -->|No| E[Mantener fila intacta]
    D -->|Sí| F[Resetear fila a cero]
    C -->|"No (Mensaje borrado)"| F
    F -->|3. Actualizar base de datos| B
```

---

## 💡 Reglas de Negocio Clave

### 1. La Regla del Pasado Bloqueado (`LOCKED`)
* Los bloques de horas ya cerrados (cuya hora de corte ya pasó) son **estrictamente de solo lectura**. 
* Si un usuario reporta tarde o edita un reporte antiguo, el bot no modificará la celda del bloque pasado en Sheets. 
* *Diferencial positivo:* Si el reporte editado o tardío presenta una cifra mayor para un bloque pasado, la diferencia se acumula y se registra en el **bloque presente** para evitar la pérdida de personal reportado sin alterar el histórico consolidado del turno anterior.

### 2. Edición y Período de Holgura
* **10 Minutos de Gracia para Edición:** Si el mensaje original se edita dentro de los primeros 10 minutos de su creación, el bot procesa la actualización utilizando la **hora original** del reporte. Si se edita después, se procesa bajo la **hora de la edición** (pudiendo clasificar el mensaje bajo un nuevo bloque horario activo).
* **Modo Revisión:** Si una edición hace que el reporte sea inválido (por ejemplo, excede la capacidad autorizada del nodo), el bot no borra la fila en Sheets de inmediato. Escribe `Revisión desde: [Timestamp]` en la columna de `Estado`. El usuario tiene **5 minutos** para corregirlo antes de que el Background Worker resetee los valores del nodo a cero.

### 3. Automatización Diaria
* **Resguardo Histórico (11:00 PM VET):** El bot toma una captura de todos los reportes del día actual y los copia en bloque a la pestaña `registros_historicos_telegram`.
* **Reset de Medianoche (12:00 AM VET):** Para iniciar la nueva jornada, el bot restablece a `0` todas las celdas de reportes (`B1`, `B2`, `B3`, `Total`) de la hoja principal, actualiza la fecha al nuevo día y aplica un ordenamiento de filas (Municipio A-Z, Nodo Menor-Mayor).

---

## ⚙️ Estructura de Google Sheets

Para el correcto funcionamiento del bot, la hoja de cálculo de Google debe contener tres pestañas específicas:

### 1. `registros_telegram` (Hoja Principal)
Es la hoja donde se reflejan las filas fijas por cada nodo. El bot inicializa esta hoja automáticamente al arrancar.

Columnas obligatorias en la fila 1:
* `Municipio` | `Nodo` | `Total Verificadores` | `Bloque 1 (9am)` | `Bloque 2 (2pm)` | `Bloque 3 (6pm)` | `Fecha` | `Hora` | `Remitente` | `ID Mensaje` | `ID Chat` | `Estado`

### 2. `verificadores_nodo` (Catálogo Oficial)
Debe ser pre-cargada manualmente por el administrador con los nodos oficiales permitidos.

Columnas obligatorias:
* `MUNICIPIO` | `NODO` | `CANTIDAD DE VERIFICADORES` (Límite máximo permitido por día para ese nodo).

### 3. `registros_historicos_telegram` (Historial)
El bot la creará e inicializará automáticamente si no existe para guardar las capturas diarias a las 11:00 PM.

---

## ⚙️ Variables de Entorno (`.env`)

Crea un archivo `.env` en la raíz del proyecto basándote en `.env.example`:

| Variable | Descripción | Ejemplo |
| :--- | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | Token de acceso del bot otorgado por @BotFather. | `123456789:ABCdefGhI...` |
| `GOOGLE_SPREADSHEET_ID`| ID de la hoja de cálculo de Google (extraído de su URL). | `1a2b3c4d5e6f7g8h9i0j...` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Correo electrónico de la cuenta de servicio de Google Cloud. | `sheets-bot@project.iam.gserviceaccount.com` |
| `GOOGLE_PRIVATE_KEY` | Llave privada completa de la cuenta de servicio (con saltos de línea `\n`). | `-----BEGIN PRIVATE KEY-----\nMIIEvgIBADAN...` |
| `PORT` | *(Opcional)* Puerto para el servicio de health-check HTTP. Por defecto es `8080`. | `8080` |
| `REPORT_EDIT_GRACE_PERIOD_MINS` | *(Opcional)* Minutos de tolerancia para editar un reporte. Por defecto es `10`. | `10` |

---

## 📦 Instrucciones de Instalación y Despliegue

### Requisitos Previos
* Docker y Docker Compose instalados en el sistema.
* Cuenta de servicio en Google Cloud con permisos de **Editor** en la hoja de cálculo.

### Paso 1: Levantar con Docker (Recomendado)
El proyecto incluye un entorno Dockerizado optimizado con reinicios automáticos ante caídas.

```bash
# Construir e iniciar el contenedor en segundo plano
docker compose up -d --build

# Monitorear los logs en tiempo real
docker compose logs -f
```

### Paso 2: Ejecución Local en Modo Desarrollo
Si deseas correr la aplicación sin contenedores directamente con Node.js:

```bash
# 1. Instalar dependencias del proyecto
npm install

# 2. Iniciar la aplicación
npm start
```

---

## 🗂️ Estructura del Proyecto

El código está estructurado bajo el principio de **Separación de Responsabilidades**:

```bash
├── bot.js                  # Punto de entrada de la aplicación y servidor de healthcheck
├── Dockerfile              # Configuración de Docker de producción (node:20-alpine)
├── docker-compose.yml      # Definición de la orquestación del contenedor
├── package.json            # Dependencias del proyecto
├── README.md               # Documentación general
├── analisis_logica_negocio.md # Especificación formal de reglas de negocio
└── src/
    ├── config/
    │   └── index.js        # Carga, tipado y validación de variables de entorno
    ├── handlers/
    │   ├── commands.js     # Manejo de comandos (/reporte, /lista, /estado)
    │   └── message.js      # Middleware receptor de mensajes y ediciones
    ├── jobs/
    │   └── cleanup.js      # Programador de cron jobs y worker de reconciliación
    ├── services/
    │   ├── notifications.js# Envío de alertas de error y avisos de cierre a Telegram
    │   ├── reporting.js    # Generación de reportes de texto y consolidados
    │   ├── reportProcessor.js# Core de la lógica de negocio (acumulación y cortes horarios)
    │   ├── sheets.business.js# Lógica de Sheets (inicialización de nodos y reordenamiento)
    │   └── sheets.js       # Capa de datos e integración básica de Google Sheets API
    └── utils/
        ├── mutex.js        # Mutex para operaciones seguras concurrentes en Sheets
        ├── parser.js       # Extracción Regex y parseo de fechas/bloques
        └── telegram.js     # Utilidades de mensajes, remitentes y reacciones
```

---

## 📄 Licencia

Este proyecto es software privado y de uso interno para la supervisión de campo. Desarrollado con fines de alta integridad de datos y automatización operativa.
