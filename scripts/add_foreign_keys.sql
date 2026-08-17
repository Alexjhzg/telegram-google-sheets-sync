-- ──────────────────────────────────────────────────────────────
-- MIGRACIÓN DDL: AGREGAR RELACIONES (FOREIGN KEYS) A BASE DE DATOS
-- ──────────────────────────────────────────────────────────────

-- 1. Agregar la clave foránea entre reportes_diarios y nodos_catalogo
-- Nota: Si la restricción ya existe, Postgres ignorará o fallará si ya está creada.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_reportes_nodos_catalogo' 
          AND table_name = 'reportes_diarios'
    ) THEN
        ALTER TABLE reportes_diarios
        ADD CONSTRAINT fk_reportes_nodos_catalogo
        FOREIGN KEY (municipio_normalizado, nodo)
        REFERENCES nodos_catalogo (municipio_normalizado, nodo)
        ON UPDATE CASCADE
        ON DELETE RESTRICT;
        
        RAISE NOTICE 'Restricción fk_reportes_nodos_catalogo agregada exitosamente.';
    ELSE
        RAISE NOTICE 'La restricción fk_reportes_nodos_catalogo ya existe.';
    END IF;
END $$;
