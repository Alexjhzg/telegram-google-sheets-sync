# 📘 Guía de Migración a TypeScript (.ts)

Este documento detalla la guía paso a paso para realizar la migración progresiva del bot desde **JavaScript (ESM)** hacia **TypeScript (.ts)**, aplicando las mejores prácticas de arquitectura, tipado estático estricto e interfaces de dominio.

---

## 🎯 Objetivos de la Migración
- **Tipado Estricto**: Eliminar errores en tiempo de ejecución (`TypeError`, `undefined` no controlado) detectándolos durante el desarrollo.
- **Interfaces de Dominio**: Definir estructuras claras para `ReporteParseado`, `NodoCatalogo`, `ValidacionResultado` y los eventos de Telegram (`grammy`).
- **Autocompletado y Productividad**: Mejorar el soporte en el editor (VS Code, Antigravity) para todas las funciones del proyecto.
- **Cero Cambios de Comportamiento**: La migración es 100% compatible con la lógica actual de Supabase y Google Sheets.

---

## 🛠️ Paso 1: Instalación de Dependencias

Ejecuta el siguiente comando en tu terminal para instalar TypeScript y el ejecutor `tsx`:

```bash
npm install -D typescript tsx @types/node
```

---

## ⚙️ Paso 2: Crear el Archivo `tsconfig.json`

Crea el archivo `tsconfig.json` en la raíz del proyecto con la siguiente configuración optimizada para Node.js 20/22 y ES Modules:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["node"]
  },
  "include": ["src/**/*", "bot.ts", "scripts/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## 📝 Paso 3: Declaración de Interfaces (`src/types/index.ts`)

Crea la carpeta `src/types/` y el archivo `index.ts` con los modelos de datos del proyecto:

```typescript
export interface ReporteParseado {
  municipio: string;
  nodo: number;
  totalVerificadores: number;
  bloque1: number;
  bloque2: number;
  bloque3: number;
  fecha: string;
  hora: string;
  remitente: string;
}

export interface ValidacionResultado {
  valido: boolean;
  limiteVerificadores: number;
  municipioOficial: string;
  razon?: string;
}

export interface NodoCatalogo {
  id?: string;
  municipio: string;
  municipio_normalizado: string;
  nodo: number;
  limite_verificadores: number;
}

export interface ReporteDiarioDB {
  id?: string;
  municipio: string;
  municipio_normalizado: string;
  nodo: number;
  fecha: string;
  hora: string;
  bloque_1: number;
  bloque_2: number;
  bloque_3: number;
  total_verificadores: number;
  remitente: string;
  telegram_message_id?: bigint | null;
  telegram_chat_id?: bigint | null;
  estado?: string;
  sincronizado_sheets?: boolean;
}
```

---

## 🔄 Paso 4: Renombrar y Tipar Módulos (Orden Sugerido)

Migra los archivos cambiando su extensión de `.js` a `.ts` e importando los tipos correspondientes:

1. **Utilidades Base**:
   - `src/utils/mutex.js` ➔ `src/utils/mutex.ts`
   - `src/utils/parser.js` ➔ `src/utils/parser.ts`
   - `src/utils/accumulation.js` ➔ `src/utils/accumulation.ts`
   - `src/utils/telegram.js` ➔ `src/utils/telegram.ts`

2. **Capa de Servicios y Base de Datos**:
   - `src/config/index.js` ➔ `src/config/index.ts`
   - `src/services/sheets.js` ➔ `src/services/sheets.ts`
   - `src/services/database.js` ➔ `src/services/database.ts`
   - `src/services/validation.js` ➔ `src/services/validation.ts`
   - `src/services/reportProcessor.js` ➔ `src/services/reportProcessor.ts`
   - `src/services/reporting.js` ➔ `src/services/reporting.ts`
   - `src/services/notifications.js` ➔ `src/services/notifications.ts`
   - `src/services/syncService.js` ➔ `src/services/syncService.ts`

3. **Handlers y Jobs**:
   - `src/handlers/message.js` ➔ `src/handlers/message.ts`
   - `src/handlers/commands.js` ➔ `src/handlers/commands.ts`
   - `src/jobs/cleanup.js` ➔ `src/jobs/cleanup.ts`
   - `scripts/seed_catalog.js` ➔ `scripts/seed_catalog.ts`
   - `bot.js` ➔ `bot.ts`

---

## ⚙️ Paso 5: Actualizar `package.json`

Actualiza la sección `"scripts"` en tu `package.json`:

```json
"scripts": {
  "start": "tsx bot.ts",
  "build": "tsc --noEmit",
  "test": "node --test",
  "db:seed": "tsx scripts/seed_catalog.ts"
}
```

---

## 🐳 Paso 6: Actualizar `Dockerfile` para Producción en Render

Asegúrate de que tu `Dockerfile` ejecute TypeScript nativamente en Node 22 mediante `tsx`:

```dockerfile
FROM node:22-alpine
WORKDIR /usr/src/app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY . .
USER node
EXPOSE 8080
CMD ["npx", "tsx", "bot.ts"]
```

---

## ✅ Paso 7: Comandos de Verificación

Una vez renombrados los archivos, ejecuta los siguientes comandos para verificar la migración:

```bash
# 1. Comprobar que no existan errores de tipos
npm run build

# 2. Ejecutar la suite de pruebas unitarias
npm test

# 3. Probar el arranque local
npm start
```
