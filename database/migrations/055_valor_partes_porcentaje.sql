-- Cada parte del Valor del Proyecto (plan de desembolsos) ahora tambien
-- guarda su porcentaje (0-100) sobre el Valor Actual del proyecto, ademas
-- del monto en pesos que ya tenia -- para que el usuario pueda dividir el
-- desembolso por porcentajes y ver si entre todas las partes cubren el
-- 100% de forma continua (sin huecos ni traslapes).
ALTER TABLE proyecto_valor_partes ADD COLUMN IF NOT EXISTS porcentaje NUMERIC(5,2);
