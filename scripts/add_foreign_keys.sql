-- ──────────────────────────────────────────────────────────────
-- MIGRACIÓN DDL: FK SIMPLE UUID EN reportes_diarios
-- Nota: Este script es para entornos limpios (fresh installs) donde
-- el schema.sql ya incluye catalogo_nodo_id. Para producción existente
-- usar migration_paso1.sql y migration_paso2.sql en ese orden.
-- ──────────────────────────────────────────────────────────────

-- Agregar la FK simple de reportes_diarios → nodos_catalogo (por UUID)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_reportes_catalogo_id' 
          AND table_name = 'reportes_diarios'
    ) THEN
        ALTER TABLE reportes_diarios
        ADD CONSTRAINT fk_reportes_catalogo_id
        FOREIGN KEY (catalogo_nodo_id)
        REFERENCES nodos_catalogo (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL;

        RAISE NOTICE 'FK fk_reportes_catalogo_id creada exitosamente.';
    ELSE
        RAISE NOTICE 'La FK fk_reportes_catalogo_id ya existe.';
    END IF;

    -- Eliminar la FK compuesta antigua si quedara de migraciones previas
    IF EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_reportes_nodos_catalogo' 
          AND table_name = 'reportes_diarios'
    ) THEN
        ALTER TABLE reportes_diarios
        DROP CONSTRAINT fk_reportes_nodos_catalogo;

        RAISE NOTICE 'FK compuesta antigua fk_reportes_nodos_catalogo eliminada.';
    END IF;
END $$;
