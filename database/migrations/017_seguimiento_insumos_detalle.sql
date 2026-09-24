-- Guarda cada renglon de la pestana "Insumos Detalle" (no solo el agregado
-- por linea) para poder mostrar el panel "Ver insumos" por tarjeta, igual
-- que en el Apps Script original.
CREATE TABLE IF NOT EXISTS seguimiento_insumos_detalle (
  insumo_id SERIAL PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES proyectos(proyecto_id),
  linea_productiva TEXT NOT NULL,
  insumo TEXT NOT NULL DEFAULT '',
  unidad TEXT NOT NULL DEFAULT '',
  componente TEXT NOT NULL DEFAULT '',
  proceso TEXT NOT NULL DEFAULT '',
  cantidad NUMERIC,
  beneficiarios NUMERIC,
  fecha_compra DATE,
  fecha_entrega DATE,
  nota_entrega TEXT NOT NULL DEFAULT '',
  llego TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT '',
  tanda TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_insumos_detalle_proyecto_linea ON seguimiento_insumos_detalle (proyecto_id, linea_productiva);
