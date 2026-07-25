BEGIN;

CREATE TABLE IF NOT EXISTS realtime_access_tickets (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS realtime_ticket_expiry_idx
  ON realtime_access_tickets(expires_at) WHERE consumed_at IS NULL;

COMMIT;
