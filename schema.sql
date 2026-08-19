-- ──────────────────────────────────────────────────────────────
-- ESQUEMA GENERAL DE BASE DE DATOS (POSTGRESQL)
-- Proyecto: Bot de Telegram para Supervisión de Campo
-- ──────────────────────────────────────────────────────────────

-- 1. Tabla de Catálogo Oficial de Nodos y Límites
CREATE TABLE IF NOT EXISTS nodos_catalogo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    municipio VARCHAR(150) NOT NULL,
    municipio_normalizado VARCHAR(150) NOT NULL,
    nodo INTEGER NOT NULL,
    limite_verificadores INTEGER DEFAULT 0 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unq_municipio_nodo UNIQUE (municipio_normalizado, nodo)
);

-- Índices para búsquedas ultra rápidas
CREATE INDEX IF NOT EXISTS idx_nodos_mun_norm ON nodos_catalogo (municipio_normalizado);
CREATE INDEX IF NOT EXISTS idx_nodos_numero ON nodos_catalogo (nodo);


-- 2. Tabla Principal de Reportes Diarios
CREATE TABLE IF NOT EXISTS reportes_diarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    municipio VARCHAR(150) NOT NULL,
    municipio_normalizado VARCHAR(150) NOT NULL,
    -- FK simple al catálogo de nodos (reemplaza la FK compuesta original)
    catalogo_nodo_id UUID NOT NULL,
    nodo INTEGER NOT NULL,
    fecha DATE NOT NULL,
    hora VARCHAR(20),
    bloque_1 INTEGER DEFAULT 0 NOT NULL,
    bloque_2 INTEGER DEFAULT 0 NOT NULL,
    bloque_3 INTEGER DEFAULT 0 NOT NULL,
    total_verificadores INTEGER DEFAULT 0 NOT NULL,
    remitente VARCHAR(150),
    telegram_message_id BIGINT,
    telegram_chat_id BIGINT,
    estado VARCHAR(50) DEFAULT 'OK',
    sincronizado_sheets BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unq_nodo_fecha UNIQUE (nodo, fecha),
    -- FK simple UUID → nodos_catalogo.id (panel relacional de Supabase compatible)
    CONSTRAINT fk_reportes_catalogo_id
        FOREIGN KEY (catalogo_nodo_id)
        REFERENCES nodos_catalogo (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
    -- NOTA: La FK compuesta original (municipio_normalizado, nodo) fue eliminada
    --       en la migración migration_paso1.sql / migration_paso2.sql
);

-- Índices para consultas por fecha, nodo y estado
CREATE INDEX IF NOT EXISTS idx_reportes_fecha ON reportes_diarios (fecha);
CREATE INDEX IF NOT EXISTS idx_reportes_nodo_fecha ON reportes_diarios (nodo, fecha);
CREATE INDEX IF NOT EXISTS idx_reportes_message_id ON reportes_diarios (telegram_message_id);
CREATE INDEX IF NOT EXISTS idx_reportes_catalogo_id ON reportes_diarios (catalogo_nodo_id);



-- 3. Tabla de Auditoría e Historial Inmutable
CREATE TABLE IF NOT EXISTS logs_auditoria (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_chat_id BIGINT,
    telegram_message_id BIGINT,
    remitente VARCHAR(150),
    accion VARCHAR(50) NOT NULL,        -- 'CREACION', 'EDICION', 'ELIMINACION', 'ERROR'
    detalles JSONB,
    -- FKs relacionales (nullable: logs de error no tienen reporte asociado)
    reporte_id UUID,                    -- FK → reportes_diarios.id (SET NULL al borrar)
    catalogo_nodo_id UUID,              -- FK → nodos_catalogo.id   (SET NULL al borrar)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT fk_auditoria_reporte
        FOREIGN KEY (reporte_id)
        REFERENCES reportes_diarios (id)
        ON DELETE SET NULL,
    CONSTRAINT fk_auditoria_catalogo
        FOREIGN KEY (catalogo_nodo_id)
        REFERENCES nodos_catalogo (id)
        ON DELETE SET NULL
);

-- Índices de auditoría
CREATE INDEX IF NOT EXISTS idx_auditoria_reporte_id   ON logs_auditoria (reporte_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_catalogo_id  ON logs_auditoria (catalogo_nodo_id);


-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS set_updated_at_nodos ON nodos_catalogo;
CREATE TRIGGER set_updated_at_nodos
    BEFORE UPDATE ON nodos_catalogo
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_reportes ON reportes_diarios;
CREATE TRIGGER set_updated_at_reportes
    BEFORE UPDATE ON reportes_diarios
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
