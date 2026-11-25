# 🤖 Telegram & Google Sheets Real-Time Synchronizer

[![Node.js](https://img.shields.io/badge/Node.js-v22+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-ESM-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![GrammY](https://img.shields.io/badge/GrammY-v1-26A5E4?style=for-the-badge&logo=telegram&logoColor=white)](https://grammy.dev/)
[![Supabase](https://img.shields.io/badge/PostgreSQL-Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com/)
[![Google Sheets API](https://img.shields.io/badge/Google%20Sheets-API%20v4-0F9D58?style=for-the-badge&logo=google-sheets&logoColor=white)](https://developers.google.com/sheets/api)
[![Docker](https://img.shields.io/badge/Docker-Enabled-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

Bot de Telegram empresarial escrito en **TypeScript (ESM)** para la **supervisión de personal y reporte de novedades en campo en tiempo real**. El sistema extrae datos estructurados mediante expresiones regulares, aplica reglas estrictas de cortes horarios y límites de capacidad contra catálogo oficial, y persiste los reportes de forma **dual y resiliente** en **PostgreSQL (Supabase)** y **Google Sheets**.

---

## ✨ Destacados de Ingeniería

- **Persistencia Dual con Degradación Elegante:** Guarda cada reporte en PostgreSQL (`reportes_diarios` + `logs_auditoria` en JSONB) y sincroniza la fila fija correspondiente en Google Sheets. Si Google Sheets sufre indisponibilidad (`503`), el reporte queda resguardado en base de datos sin pérdida de información.
- **Resiliencia ante Fallos Transitorios (`src/utils/retry.ts`):** Motor de reintentos con **backoff exponencial y jitter** para errores `503`, `502`, `504`, `429`, `408` y cortes de socket.
- **Concurrencia Segura (`src/utils/mutex.ts`):** `Mutex` reentrante basado en `AsyncLocalStorage` que serializa escrituras concurrentes sobre Google Sheets evitando condiciones de carrera y deadlocks.
- **Arquitectura de Filas Fijas:** Actualización in-place sobre un catálogo pre-poblado por nodo para mantener intactas las fórmulas nativas (`SUMIFS`/`COUNTIFS`) de los tableros gerenciales.
- **Automatización Programada (`croner` en zona `America/Caracas`):** Limpieza cada 5 min con aislamiento por fila, sincronización de catálogo cada 15 min, avisos de cierre y reportes consolidados por corte (`9:00`, `14:00`, `18:00`), resguardo histórico (`23:00`) y reset de medianoche (`00:00`).
- **Calidad Verificada:** 57 pruebas automatizadas (`tsx --test`) incluyendo simulación de errores `503` y pruebas adversarias, ESLint Flat Config, Prettier y CI en GitHub Actions.

---

## ⚙️ Comandos Administrativos

Restringidos a administradores/creadores de grupo o a los `TELEGRAM_MANAGER_CHAT_ID` autorizados en privado (`src/utils/telegram.ts`):

| Comando | Descripción |
| :--- | :--- |
| `/reporte` | Genera el consolidado de asistencia en tiempo real, desglose de faltantes y leyenda. |
| `/lista` | Muestra una tabla monoespaciada nodo por nodo (`9a \| 2p \| 6p \| Tot`) del día en curso. |
| `/estado` | Diagnóstico del sistema (conexión a Google Sheets, nodos reportados, horario laboral, uptime, memoria y hora VET). |
| `/actualizar` | Sincroniza y reconcilia manualmente el catálogo `verificadores_nodo` (Sheets) hacia `nodos_catalogo` (PostgreSQL). |

---

## 📚 Documentación Técnica

| Documento | Contenido |
| :--- | :--- |
| [`docs/PRD.md`](docs/PRD.md) | Visión de producto, personas, requerimientos funcionales/no funcionales y métricas. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Diagramas Mermaid C4, flujos de resiliencia 503, topología Docker/Render y ADRs. |
| [`docs/database_model.md`](docs/database_model.md) | Diagrama ERD PostgreSQL (`schema.sql`), índices, triggers y modelo de pestañas de Sheets. |
| [`docs/API.md`](docs/API.md) | Endpoints HTTP (`/`, `/healthz`), contratos de comandos, regex de ingesta e integraciones externas. |
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) | Estándares de interfaz conversacional en Telegram (reacciones, emojis, Markdown y plantillas). |
| [`docs/CODE_STYLE.md`](docs/CODE_STYLE.md) | Convenciones de TypeScript ESM, ESLint, Prettier y reglas de resiliencia. |
| [`SECURITY.md`](SECURITY.md) | Controles actuales (RBAC, contenedor no-root, secretos) y hoja de ruta de endurecimiento. |

---

## 🗂️ Estructura del Proyecto

```text
├── bot.ts                         # Punto de entrada, Grammy polling y servidor HTTP (/healthz)
├── schema.sql                     # Esquema PostgreSQL/Supabase (tablas, índices, FKs y triggers)
├── Dockerfile                     # Imagen de producción (node:22-alpine, USER node)
├── docker-compose.yml             # Orquestación local con rotación de logs y SIGTERM limpio
├── eslint.config.mjs              # Configuración ESLint Flat Config (TypeScript + Prettier)
├── .github/workflows/ci.yml       # Pipeline CI (lint, typecheck y tests)
├── docs/                          # Documentación de arquitectura, producto, BD, API y estilo
├── .agents/                       # Reglas de ingeniería y skills por rol
├── src/
│   ├── config/index.ts            # Carga y validación de variables de entorno y horarios VET
│   ├── handlers/
│   │   ├── commands.ts            # Comandos /reporte, /lista, /estado, /actualizar
│   │   └── message.ts             # Ingesta de reportes, ediciones, holgura y eliminación
│   ├── jobs/
│   │   └── cleanup.ts             # Tareas Croner (limpieza, cortes, reportes, histórico, reset)
│   ├── services/
│   │   ├── catalogService.ts      # Sincronización del catálogo Sheets → PostgreSQL
│   │   ├── database.ts            # Cliente Supabase, UPSERT y auditoría JSONB
│   │   ├── notifications.ts       # Avisos de cierre y alertas de nodos faltantes
│   │   ├── reporting.ts           # Consolidado general y desglose de faltantes
│   │   ├── reportProcessor.ts     # Orquestador de negocio y persistencia dual resiliente
│   │   ├── sheets.business.ts     # Inicialización y ordenamiento de filas fijas
│   │   ├── sheets.ts              # Cliente Google Sheets API v4 protegido con retry
│   │   ├── syncService.ts         # Sincronización puntual hacia Google Sheets
│   │   └── validation.ts          # Validación contra catálogo oficial en Sheets
│   ├── types/index.ts             # Interfaces y modelos de dominio TypeScript
│   └── utils/
│       ├── accumulation.ts        # Regla de pasado bloqueado y acumulación por bloques
│       ├── dateUtils.ts           # Normalización de fechas en America/Caracas
│       ├── mutex.ts               # Mutex reentrante con AsyncLocalStorage
│       ├── parser.ts              # Extracción Regex y cálculo de bloque activo
│       ├── retry.ts               # Motor de reintentos exponenciales con jitter
│       └── telegram.ts            # Utilidades de remitentes, reacciones y verificación admin
└── tests/                         # 57 pruebas automatizadas (unitarias, resiliencia 503 y adversarias)
```

---

## 🚀 Instalación y Ejecución

### 1. Variables de Entorno
Copia `.env.example` a `.env` y completa tus credenciales (ver [`.env.example`](.env.example)):

```bash
cp .env.example .env
```

### 2. Ejecución con Docker (Recomendado)
```bash
docker compose up -d --build
docker compose logs -f
```

### 3. Desarrollo Local y Verificación
```bash
npm install
npm run lint          # Análisis estático ESLint
npm run build         # Verificación de tipos TypeScript (tsc --noEmit)
npm test              # Suite completa de 57 pruebas (tsx --test)
npm start             # Iniciar el bot
```

---

## 📄 Licencia

Proyecto desarrollado para automatización operativa y supervisión de campo.
