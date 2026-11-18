-- Marca si ya se listaron los hijos de una carpeta de drive_copy_items,
-- para la nueva fase de mapeo previo (scanSourceItemsBatch en
-- server/google-drive.ts): antes de copiar o validar, se recorre TODO el
-- árbol de origen una vez, así el total mostrado es el real desde el
-- principio en vez de ir creciendo a medida que la copia descubre más.
ALTER TABLE drive_copy_items ADD COLUMN IF NOT EXISTS scanned BOOLEAN NOT NULL DEFAULT FALSE;
