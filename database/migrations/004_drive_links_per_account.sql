ALTER TABLE drive_links ADD COLUMN IF NOT EXISTS google_email VARCHAR(320);

UPDATE drive_links SET google_email = 'default' WHERE google_email IS NULL;

ALTER TABLE drive_links DROP CONSTRAINT IF EXISTS drive_links_pkey;
ALTER TABLE drive_links ALTER COLUMN google_email SET NOT NULL;
ALTER TABLE drive_links ADD PRIMARY KEY (google_email);
ALTER TABLE drive_links DROP COLUMN IF EXISTS config_id;
