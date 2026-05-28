# ──────────────────────────────────────────────────────────────
# Dockerfile — Bot de Telegram para supervisión en campo
# Imagen base: node:20-alpine (liviana y segura para producción)
# ──────────────────────────────────────────────────────────────

FROM node:20-alpine

# Metadatos de la imagen
LABEL maintainer="equipo-devops"
LABEL description="Bot de Telegram para supervisión de personal en campo"

# Establecer el directorio de trabajo dentro del contenedor
WORKDIR /usr/src/app

# ── PASO 1: Copiar solo los archivos de dependencias ──────────
# Se copian primero para aprovechar la caché de capas de Docker.
# Si el código cambia pero package.json no, esta capa se reutiliza.
COPY package.json package-lock.json* ./

# ── PASO 2: Instalar solo dependencias de producción ──────────
# --omit=dev excluye devDependencies para reducir el tamaño de la imagen.
# --frozen-lockfile garantiza instalaciones reproducibles.
RUN npm ci --omit=dev

# ── PASO 3: Copiar el resto del código fuente ─────────────────
# El .dockerignore excluye node_modules, .env y otros archivos innecesarios.
COPY . .

# ── Configuración de seguridad: ejecutar como usuario no-root ─
# El usuario 'node' viene incluido en la imagen oficial node:alpine.
USER node

# ── Puerto: Exponer el puerto para Render (HTTP Server / Health Check) ──
EXPOSE 8080

# ── Comando de inicio ─────────────────────────────────────────
CMD ["node", "bot.js"]
