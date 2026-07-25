BEGIN;

CREATE TABLE IF NOT EXISTS registration_idempotency (
  idempotency_key text PRIMARY KEY,
  email text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS registration_idempotency_user_idx
  ON registration_idempotency(user_id,created_at DESC);

COMMIT;
