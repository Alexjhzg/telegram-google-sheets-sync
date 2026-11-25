# 🤖 Sistema de Agentes y Reglas de Ingeniería (`bot-telegram-campo`)

Este documento establece las normas obligatorias de ingeniería, calidad, tipado, verificación en runtime y diseño conversacional para cualquier agente de IA o desarrollador que opere sobre este repositorio.

> **Relación con agentes especializados previos:** Se conservan intactas las definiciones especializadas de bots en [`.agents/agents/AGENTS.md`](./agents/AGENTS.md). Este archivo unifica las reglas transversales del repositorio y coordina las skills por rol ubicadas en `.agents/skills/`.

---

## 1. Mapa de Skills por Rol

| Rol | Skill | Responsabilidad Principal |
| :--- | :--- | :--- |
| **Tech Lead** | [`.agents/skills/tech-lead/SKILL.md`](./skills/tech-lead/SKILL.md) | Arquitectura, ADRs, revisión de PRs, control de deuda técnica y coherencia entre `docs/` y el código. |
| **Backend Dev** | [`.agents/skills/backend-dev/SKILL.md`](./skills/backend-dev/SKILL.md) | Handlers Grammy, lógica de negocio (`reportProcessor.ts`), resiliencia (`retry.ts`, `mutex.ts`) y cron jobs (`cleanup.ts`). |
| **Conversational UX** | [`.agents/skills/conversational-ux/SKILL.md`](./skills/conversational-ux/SKILL.md) | Estándares de interfaz conversacional en Telegram (`docs/DESIGN_SYSTEM.md`), formato Markdown, emojis y legibilidad móvil. |
| **DBA / Data Engineer** | [`.agents/skills/dba-data-engineer/SKILL.md`](./skills/dba-data-engineer/SKILL.md) | Esquema PostgreSQL/Supabase (`schema.sql`), migraciones, integridad referencial y sincronización dual con Google Sheets. |
| **QA Engineer** | [`.agents/skills/qa-engineer/SKILL.md`](./skills/qa-engineer/SKILL.md) | Pruebas automatizadas (`tsx --test`), simulación de fallos 503/red, pruebas adversarias y validación de regresiones. |

---

## 2. Reglas Obligatorias de Calidad y Código

1. **Veracidad estricta:** Nunca documentar ni asumir rutas, comandos, tablas, variables de entorno o librerías inexistentes. Verificar siempre contra el código fuente real.
2. **Módulos ESM (`NodeNext`):** Todo import relativo en archivos `.ts` debe llevar extensión `.js`.
3. **Tipado estricto en código nuevo:** Aunque `tsconfig.json` mantiene `strict: false` por compatibilidad histórica, todo archivo o función nueva debe evitar `any`, usar tipos explícitos desde `src/types/index.ts` y tratar errores en `catch` como `unknown`.
4. **Concurrencia y resiliencia obligatorias:**
   - Toda escritura o secuencia lectura-escritura en Google Sheets debe estar protegida por `sheetsMutex.runExclusive(...)` (`src/utils/mutex.ts`).
   - Toda llamada de red a Google Sheets debe usar `ejecutarConReintento(...)` (`src/utils/retry.ts`).
   - Ningún handler de Telegram (`src/handlers/message.ts`, `src/handlers/commands.ts`) puede dejar escapar excepciones sin capturar hacia `bot.catch`.
5. **Seguridad y secretos:** Nunca exponer `.env`, llaves privadas de Google, tokens de Telegram ni cabeceras `Authorization` en logs o commits. Todo comando administrativo debe validar `esUsuarioAdmin(ctx)`.
6. **UI/UX Conversacional (Telegram):** Seguir [docs/DESIGN_SYSTEM.md](../docs/DESIGN_SYSTEM.md): reacciones `👍`/`👎` para feedback inmediato, respuestas enlazadas con `reply_parameters: { message_id }`, Markdown válido y mensajes accionables en español.

---

## 3. Verificación Obligatoria en Runtime

Antes de dar cualquier cambio por terminado, el agente **debe** ejecutar y reportar el resultado real de:

```bash
npm run lint          # Análisis estático ESLint
npm run build         # Verificación de tipos TypeScript (tsc --noEmit)
npm test              # Suite completa de pruebas (tsx --test)
```

---

## 4. Documentación Canónica de Referencia

- **Producto:** [`docs/PRD.md`](../docs/PRD.md)
- **Arquitectura y ADRs:** [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)
- **Base de Datos y Sheets:** [`docs/database_model.md`](../docs/database_model.md)
- **Contratos de API y Comandos:** [`docs/API.md`](../docs/API.md)
- **Diseño Conversacional:** [`docs/DESIGN_SYSTEM.md`](../docs/DESIGN_SYSTEM.md)
- **Estilo de Código:** [`docs/CODE_STYLE.md`](../docs/CODE_STYLE.md)
- **Seguridad:** [`SECURITY.md`](../SECURITY.md)

