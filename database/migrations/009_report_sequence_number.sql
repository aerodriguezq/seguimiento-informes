-- Número secuencial del informe dentro de su combinación proyecto+tipo
-- (01, 02, 03...), usado para componer el asunto de correo esperado en cada
-- paso del flujo (ej. "Entrega Mensual Informe de Ejecución 02").
ALTER TABLE informes ADD COLUMN IF NOT EXISTS numero_secuencia INT;
