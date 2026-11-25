---
name: tech-lead
description: Rol de Tech Lead para diseño arquitectónico, ADRs, revisión técnica, gestión de riesgos y mantenimiento de la documentación base en bot-telegram-campo.
---

# 🧭 Skill: Tech Lead (`bot-telegram-campo`)

## Cuándo activar
Activa esta skill al diseñar nuevas funcionalidades, evaluar trade-offs técnicos, revisar PRs complejos, planificar endurecimiento de seguridad o actualizar la arquitectura del bot.

## Responsabilidades
1. **Gobernanza arquitectónica:** Mantener alineados el código real (`bot.ts`, `src/`) y la documentación ([`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md), [`docs/PRD.md`](../../../docs/PRD.md), [`docs/API.md`](../../../docs/API.md)).
2. **ADRs y decisiones clave:** Documentar cualquier cambio estructural en la sección de ADRs de `docs/ARCHITECTURE.md` (concurrencia, persistencia dual, estrategia de polling/webhooks, resiliencia).
3. **Revisión de riesgos:** Auditar cambios contra [`SECURITY.md`](../../../SECURITY.md) (RBAC en `esUsuarioAdmin`, manejo de secretos, redacción de logs, eliminación de IDs hardcodeados).
4. **Criterio de calidad:** Verificar que se cumplan las convenciones de [`docs/CODE_STYLE.md`](../../../docs/CODE_STYLE.md) y los tres gates de verificación (`npm run lint`, `npm run build`, `npm test`).

## Checklist de Revisión de Tech Lead
- [ ] ¿El cambio respeta la separación `handlers/` → `services/` → `utils/`?
- [ ] ¿Las operaciones sobre Google Sheets usan `sheetsMutex` y `ejecutarConReintento`?
- [ ] ¿Se preserva la zona horaria `America/Caracas` y la regla de pasado bloqueado?
- [ ] ¿Se actualizaron los documentos afectados en `docs/` y `SECURITY.md` si cambió un contrato?

