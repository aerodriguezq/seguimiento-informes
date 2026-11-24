// Un error nuestro (`throw new Error('mensaje amigable')`) es seguro de
// mostrar tal cual -- lo escribimos nosotros a propósito para el usuario.
// Un NeonDbError es la excepción cruda del driver de Postgres: su .message
// puede traer nombres de columnas, tablas o constraints internos. Antes
// varios catch reenviaban error.message sin distinguir entre los dos.
export function toClientErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.name !== 'NeonDbError') {
    return error.message;
  }
  return fallback;
}
