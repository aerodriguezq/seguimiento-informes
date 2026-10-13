-- Relleno retroactivo: antes de 037_historial_correo_link.sql, una
-- detección automática avanzaba el paso (y guardaba correo_gmail_id en
-- informe_pasos_instancia) pero NO dejaba ninguna entrada en el Historial
-- de Trazabilidad -- solo se veía en la etapa individual. Esto agrega esa
-- entrada faltante para cada paso que ya tiene un correo detectado
-- guardado, así ningún correo detectado queda fuera del registro de
-- auditoría. Es seguro correrlo más de una vez (no duplica filas ya
-- insertadas, gracias al NOT EXISTS).
INSERT INTO seguimiento_informe (seguimiento_id, informe_id, estado, fecha_evento, usuario_nombre, comentario, correo_link)
SELECT
  (SELECT COALESCE(MAX(seguimiento_id), 0) FROM seguimiento_informe) + ROW_NUMBER() OVER (ORDER BY ipi.informe_id, ipi.paso_id),
  ipi.informe_id,
  i.estado,
  COALESCE(ipi.fecha_recepcion_real, ipi.updated_at, NOW()),
  'Sistema (detección automática, registro retroactivo)',
  'Correo detectado para "' || wp.nombre || '"' ||
    CASE WHEN ipi.correo_remitente IS NOT NULL AND ipi.correo_remitente <> '' THEN ' de ' || ipi.correo_remitente ELSE '' END || '.',
  'https://mail.google.com/mail/u/0/#all/' || ipi.correo_gmail_id
FROM informe_pasos_instancia ipi
JOIN informes i ON i.informe_id = ipi.informe_id
JOIN tipo_informe_pasos wp ON wp.paso_id = ipi.paso_id
WHERE ipi.correo_gmail_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM seguimiento_informe si
    WHERE si.informe_id = ipi.informe_id
      AND si.correo_link = 'https://mail.google.com/mail/u/0/#all/' || ipi.correo_gmail_id
  );
