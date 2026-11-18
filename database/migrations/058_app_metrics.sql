-- Tabla genérica para medir eficiencia de toda la app: cada función de la
-- API registra cuánto se demoró y con qué código de respuesta, y el
-- navegador manda cuánto tardó en cargar la página y si hubo un error de
-- JavaScript sin capturar. event_type distingue 'api_request' /
-- 'client_page_load' / 'client_error' -- un solo lugar para los tres en vez
-- de tres tablas, ya que todos comparten la misma forma (cuándo, cuánto
-- tardó, si hubo error).
CREATE TABLE IF NOT EXISTS app_metrics (
  metric_id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  route TEXT,
  method TEXT,
  status_code INTEGER,
  duration_ms INTEGER,
  error_message TEXT,
  extra JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_metrics_type_created ON app_metrics (event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_app_metrics_route ON app_metrics (route, created_at);
