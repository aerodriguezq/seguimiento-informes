CREATE TABLE IF NOT EXISTS google_drive_sessions (
  session_id UUID PRIMARY KEY,
  google_email VARCHAR(320) NOT NULL,
  token_json TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);