# 🏗️ Arquitectura General del Sistema

Este documento describe la arquitectura técnica, componentes, flujo de datos y estrategia de persistencia del **Bot de Telegram para Supervisión de Campo y Sincronización Dual (Supabase + Google Sheets)**.

---

## 📐 Diagrama de Arquitectura de Alto Nivel

```mermaid
graph TB
    subgraph CAPA_ENTRADA [📱 Capa de Entrada - Telegram Client]
        Supervisores[👨‍💼 Supervisores en Campo]
        Gerentes[📈 Gerentes y Administradores]
    end

    subgraph CAPA_APLICACION [🤖 Capa de Aplicación - Node.js 22 Container / Render]
        subgraph ENGINE [Core & Middleware]
            BotEngine[bot.js / Grammy Engine]
            HTTPServer[Servidor HTTP Keep-Alive / Port 8080]
        end

        subgraph HANDLERS [Manejo de Eventos]
            MsgHandler[src/handlers/message.js]
            CmdHandler[src/handlers/commands.js]
        end

        subgraph BUSINESS_LOGIC [Procesamiento & Negocio]
            ReportProcessor[src/services/reportProcessor.js]
            Normalizer[src/services/sheets.js - normalizarTexto]
            Reporting[src/services/reporting.js]
            Notifications[src/services/notifications.js]
            Accumulator[src/utils/accumulation.js]
        end

        subgraph CRONJOBS [Tareas Programadas - Croner]
            CleanupJobs[src/jobs/cleanup.js]
        end

        subgraph DATA_ACCESS [Acceso a Datos]
            DBService[src/services/database.js]
            SyncService[src/services/syncService.js]
            SheetsMutex[src/utils/mutex.js - Mutex Global]
        end
    end

    subgraph CAPA_PERSISTENCIA [🗄️ Capa de Persistencia Dual]
        subgraph SUPABASE_DB [Base de Datos Relacional PostgreSQL / Supabase]
            NodosCat[nodos_catalogo]
            ReportesDiarios[reportes_diarios - UNIQUE nodo,fecha]
            AuditLogs[logs_auditoria - JSONB]
        end

        subgraph GOOGLE_SHEETS [Google Sheets API v4]
            RegTelegram[registros_telegram]
            VerifNodo[verificadores_nodo]
            RegHistoricos[registros_historicos_telegram]
            ReporteNodo[reporte_nodo - Fórmulas Nativas]
            ReporteMun[reporte_diario_municipio - Totales]
            NodosFaltantes[nodos_sin_reportes]
        end
    end

    %% Relaciones Entrada -> Aplicación
    Supervisores -->|Reportes de Texto| BotEngine
    Gerentes -->|Comandos /reporte, /lista| BotEngine
    BotEngine --> MsgHandler
    BotEngine --> CmdHandler

    %% Flujo de Procesamiento Interno
    MsgHandler --> ReportProcessor
    CmdHandler --> Reporting
    ReportProcessor --> Normalizer
    ReportProcessor --> Accumulator
    ReportProcessor --> DBService
    ReportProcessor --> SyncService

    %% Persistencia Supabase
    DBService -->|UPSERT 5ms| ReportesDiarios
    DBService -->|INSERT Audit| AuditLogs
    DBService -->|SELECT Catálogo| NodosCat

    %% Persistencia y Sincronización Google Sheets
    SyncService --> SheetsMutex
    SheetsMutex -->|Fila Fija Real-Time| RegTelegram
    RegTelegram -->|Formulas Nativas SUMIFS| ReporteNodo
    ReporteNodo -->|Formulas Nativas SUMIF/COUNTIFS| ReporteMun

    %% Cronjobs y Notificaciones
    CleanupJobs -->|09:00, 14:00, 18:00 VET| Notifications
    CleanupJobs -->|09:05, 14:05, 18:05 VET| Reporting
    CleanupJobs -->|11:00 PM Resguardo| RegHistoricos
    Reporting -->|Consolidado + Desglose| Gerentes
    Notifications -->|Avisos y Alertas| Supervisores
```

---

## 🧩 Componentes Principales y Responsabilidades

### 1. Engine y Servidor (`bot.js`)
- Inicializa el cliente Grammy con el token de Telegram.
- Expone un servidor HTTP de keep-alive en el puerto `8080`/`10000` para mantener el servicio activo en Render sin cierres por inactividad.

### 2. Capa de Negocio (`src/services/`)
- **`reportProcessor.js`**: Orquesta el procesamiento de reportes. Extrae municipio/nodo, aplica normalización de texto (`normalizarTexto`), consulta los valores anteriores del día, acumula los bloques y ejecuta el guardado dual.
- **`database.js`**: Cliente agnóstico de PostgreSQL (Supabase) con opciones optimizadas para Node.js (`realtime: { disabled: true }`). Realiza validación de nodos, `UPSERT` en `reportes_diarios` e inserta auditoría con `JSONB`.
- **`syncService.js`**: Canal de resguardo asíncrono que actualiza la fila fija en Google Sheets de forma coordinada a través del `Mutex` global.
- **`reporting.js`**: Genera los informes consolidados, calcula porcentajes de avance del estado Monagas y construye el desglose de nodos faltantes.

### 3. Tareas Programadas (`src/jobs/cleanup.js`)
- **Avisos de Cierre (09:00 AM, 02:00 PM, 06:00 PM VET)**: Informa el cambio de bloque activo en el grupo.
- **Reporte a Gerencia (09:05 AM, 02:05 PM, 06:05 PM VET)**: Envía los resúmenes consolidados de porcentajes y el desglose final de faltantes.
- **Alerta de Inactivos (06:06 PM VET)**: Identifica y guarda en `nodos_sin_reportes` los nodos con 0 reportes en el día.
- **Resguardo Nocturno (11:00 PM VET)**: Copia inmutable a `registros_historicos_telegram`.
- **Reset Diario (12:00 AM VET)**: Limpia y reordena la hoja principal para la nueva jornada.

---

## 🗄️ Arquitectura de Persistencia Dual

```mermaid
sequenceDiagram
    autonumber
    actor Sup as 👨‍💼 Supervisor
    participant Bot as 🤖 Bot (Node.js)
    participant DB as 🗄️ PostgreSQL (Supabase)
    participant Sheets as 📊 Google Sheets

    Sup->>Bot: Envía mensaje de reporte en Telegram
    Bot->>Bot: Parseo, Normalización ("maturin") y Cálculo de Bloques
    
    par Persistencia Inmediata
        Bot->>DB: UPSERT en 'reportes_diarios' (5ms) + Audit JSONB
        Bot->>Sheets: Actualiza Fila Fija en 'registros_telegram'
    end
    
    Bot-->>Sup: Reacciona con 👍 en Telegram
    
    note over Sheets: Google Sheets Recálculo Automático
    Sheets->>Sheets: 'reporte_nodo' recalcula con SUMIFS
    Sheets->>Sheets: 'reporte_diario_municipio' recalcula Totales
```
