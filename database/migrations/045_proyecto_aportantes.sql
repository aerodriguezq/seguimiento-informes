-- Quién financia el precio total del contrato y cuánto aporta cada uno
-- (Gobernación, Cooperación Internacional, Contrapartida, etc.) -- distinto
-- de proyecto_valor_partes (que reparte el valor en el tiempo como
-- desembolsos), esto reparte el valor por fuente de financiación.
CREATE TABLE IF NOT EXISTS proyecto_aportantes (
  aportante_id SERIAL PRIMARY KEY,
  proyecto_id BIGINT NOT NULL REFERENCES proyectos(proyecto_id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  monto NUMERIC NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proyecto_aportantes_proyecto ON proyecto_aportantes (proyecto_id);
