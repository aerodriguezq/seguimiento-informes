-- Permite a los administradores elegir que columnas se muestran en el panel
-- "Ver insumos" de Seguimiento. NULL = mostrar todas (comportamiento actual).
ALTER TABLE seguimiento_config ADD COLUMN IF NOT EXISTS insumos_columnas_visibles JSONB;
