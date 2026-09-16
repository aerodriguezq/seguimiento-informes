CREATE TABLE IF NOT EXISTS drive_links (
  config_id SMALLINT PRIMARY KEY,
  source_url TEXT NOT NULL,
  destination_url TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);