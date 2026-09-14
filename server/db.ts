export async function getSql() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl?.trim()) {
    throw new Error('DATABASE_URL no está configurada.');
  }

  const { neon } = await import('@neondatabase/serverless');
  return neon(databaseUrl);
}