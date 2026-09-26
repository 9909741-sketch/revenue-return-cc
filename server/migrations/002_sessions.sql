-- Shared persistent session storage for server restarts and multiple instances.
CREATE TABLE IF NOT EXISTS sessions (
  sid varchar NOT NULL COLLATE "default",
  sess json NOT NULL,
  expire timestamp(6) NOT NULL,
  CONSTRAINT sessions_pkey PRIMARY KEY (sid)
);

CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions (expire);