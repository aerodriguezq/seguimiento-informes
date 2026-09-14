import { neon } from '@neondatabase/serverless';

export function getSql() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL no está configurada.');
  }

  return neon(databaseUrl);
}