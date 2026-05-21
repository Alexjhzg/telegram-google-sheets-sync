# 🤖 Telegram & Google Sheets Real-Time Synchronizer

[![Node.js](https://img.shields.io/badge/Node.js-v20+-green.svg?style=for-the-badge&logo=node.js)](https://nodejs.org/)
[![GrammY](https://img.shields.io/badge/GrammY-v1+-blue.svg?style=for-the-badge&logo=telegram)](https://grammy.dev/)
[![Google Sheets API](https://img.shields.io/badge/Google%20Sheets-API-red.svg?style=for-the-badge&logo=google-sheets)](https://developers.google.com/sheets/api)
[![Docker](https://img.shields.io/badge/Docker-Enabled-blue.svg?style=for-the-badge&logo=docker)](https://www.docker.com/)

Un bot de Telegram empresarial e inteligente diseñado para la **supervisión de personal y reporte de novedades en campo en tiempo real**. El sistema extrae datos de reportes enviados por chats/grupos de Telegram mediante expresiones regulares y los sincroniza al instante en una hoja de cálculo de Google Sheets. 

Además, cuenta con un **sistema de reconciliación en segundo plano** que monitoriza si los reportes originales han sido borrados de Telegram y, en ese caso, elimina de forma segura las filas correspondientes de Google Sheets para garantizar una consistencia absoluta de los datos.

---

## 🚀 Características Principales

* 📊 **Sincronización en Tiempo Real:** Recepción de mensajes en Telegram, extracción inteligente de datos (Municipios, Nodos, Totales) y registro inmediato en Google Sheets.
* 🧹 **Limpieza Automática Resiliente:** Worker en segundo plano que detecta mensajes borrados en Telegram y elimina sus filas en la hoja de cálculo.
* ⏱️ **Planificación Precisa con Croner:** Gestión del tiempo declarativa y robusta basada en la zona horaria nativa de Venezuela (`America/Caracas`), con limpiezas continuas (cada 5 min) y cortes de precisión (9:00 AM, 2:00 PM y 6:00 PM VET).
* 🛡️ **Seguridad y Resiliencia:** 
  * Ignorado silencioso de errores transitorios de la API de Telegram para evitar spam en los logs.
  * Algoritmo de eliminación en orden inverso para mitigar desfases de índices de filas en Google Sheets.
  * Respeto estricto del *rate limit* de Telegram a través de retrasos artificiales configurables.
* 🐳 **Entorno Dockerizado:** Despliegue con un solo comando en contenedores seguros (`node:20-alpine`).

---

## 🛠️ Arquitectura de la Solución

```mermaid
graph TD
    A[Mensaje en Grupo Telegram] -->|1. Evento de Mensaje| B(Bot Telegram - Grammy)
    B -->|2. Parser regex| C{¿Es Formato de Reporte?}
    C -->|Sí| D[Registrar Fila en Google Sheets]
    C -->|No| E[Ignorar Mensaje]
    
    F[Croner Scheduler] -->|Cada 5 min / Horas de Corte| G(Job de Limpieza)
    G -->|3. Leer Filas| H[Google Sheets]
    H -->|4. Validar existencia de Message ID| B
    B -->|5. ¿Existe mensaje en API?| I{¿Mensaje borrado?}
    I -->|Sí| J[Borrar Fila de Sheets en orden inverso]
    I -->|No| K[Mantener Fila]
```

---

## ⚙️ Configuración del Entorno (`.env`)

Crea un archivo `.env` en la raíz del proyecto basándote en `.env.example`:

| Variable | Descripción | Ejemplo |
| :--- | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | Token de acceso de tu bot otorgado por @BotFather. | `123456789:ABCdefGhI...` |
| `GOOGLE_SPREADSHEET_ID`| ID de la hoja de cálculo de Google (extraído de la URL de Sheets). | `1a2b3c4d5e6f7g8h9i0j...` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Correo electrónico de la cuenta de servicio de Google Cloud. | `sheets-bot@project.iam.gserviceaccount.com` |
| `GOOGLE_PRIVATE_KEY` | Llave privada completa de la cuenta de servicio (con saltos de línea `\n`). | `-----BEGIN PRIVATE KEY-----\nMIIEvgIBADAN...` |

---

## 📦 Instrucciones de Instalación y Despliegue

### Requisitos Previos
* Docker y Docker Compose instalados en el sistema.
* Una cuenta de servicio de Google Cloud con permisos de edición compartidos en tu hoja de cálculo.

### Paso 1: Configurar la Hoja de Google Sheets
1. Crea una hoja de cálculo nueva en Google Sheets.
2. Nombra la primera hoja/pestaña exactamente como: **`Reportes`**.
3. Añade las siguientes cabeceras exactas en la fila 1:
   `ID` | `Municipio` | `Nodo` | `Total` | `Chat ID` | `Message ID` | `Fecha`
4. Comparte la hoja de cálculo otorgándole permisos de **Editor** al correo de tu cuenta de servicio (`GOOGLE_SERVICE_ACCOUNT_EMAIL`).

### Paso 2: Despliegue con Docker (Recomendado)
El proyecto cuenta con dockerización completa y reinicios automáticos ante fallos.

```bash
# Construir e iniciar el contenedor en segundo plano
docker compose up -d --build

# Ver los logs del bot en tiempo real
docker compose logs -f
```

### Paso 3: Ejecución en Modo Desarrollo (Local)
Si deseas ejecutar la aplicación directamente en Node.js local:

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar el bot en desarrollo
npm start
```

---

## 🗂️ Estructura del Código

```bash
├── bot.js                  # Punto de entrada principal de la aplicación
├── Dockerfile              # Configuración de Docker para node:20-alpine
├── docker-compose.yml      # Orquestación de servicios en Docker
├── package.json            # Dependencias del proyecto (Grammy, Google-Spreadsheet, Croner)
├── src/
│   ├── config/
│   │   └── index.js        # Configuración centralizada y variables de entorno
│   ├── handlers/
│   │   └── message.js      # Middleware de recepción y parseo de mensajes
│   ├── jobs/
│   │   └── cleanup.js      # Worker de limpieza planificada con Croner
│   ├── services/
│   │   └── sheets.js       # Integración con Google Sheets API (JWT Auth)
│   └── utils/
│       └── parser.js       # Expresiones regulares para extracción de datos
└── .gitignore              # Archivo de exclusión de Git (Seguridad de credenciales)
```

---

## 🧹 Detalles del Job de Limpieza
El proceso de limpieza implementa medidas de alta resiliencia:
1. **Recorrido Inverso:** Para evitar el desplazamiento de índices al eliminar filas físicas de Google Sheets, el bucle procesa los registros desde el final hasta el principio (`filas.length - 1` hasta `0`).
2. **Mitigación de Rate Limit:** El bot añade un retardo de `100ms` entre la comprobación de cada fila para evitar bloqueos por parte de los servidores de Telegram.
3. **Manejo de Errores de API:** Se ignoran fallos menores (como reacciones ausentes `REACTION_EMPTY`) y se trata la clave de error `MESSAGE_ID_INVALID` como indicación absoluta de mensaje eliminado.

---

## 📄 Licencia

Este proyecto es software privado y de uso interno para la supervisión de campo. Desarrollado con fines de alta integridad de datos y automatización operativa.
