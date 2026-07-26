BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;

CREATE TABLE IF NOT EXISTS account_recovery_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  requested_ip_hash text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS user_mfa (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_ciphertext bytea NOT NULL,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id,code_hash)
);

CREATE TABLE IF NOT EXISTS mfa_login_challenges (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_hash text NOT NULL UNIQUE,
  ip_hash text,
  user_agent_hash text,
  device_name text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS user_consents (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN (
    'terms','privacy','essential-processing','analytics','marketing','blockchain-research'
  )),
  version text NOT NULL,
  status text NOT NULL CHECK (status IN ('granted','denied','withdrawn')),
  source text NOT NULL DEFAULT 'account-center',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,purpose)
);

CREATE TABLE IF NOT EXISTS consent_history (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  version text NOT NULL,
  status text NOT NULL,
  source text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS privacy_requests (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  request_type text NOT NULL CHECK (request_type IN ('export','deletion')),
  status text NOT NULL CHECK (status IN (
    'requested','processing','ready','scheduled','completed','cancelled','rejected'
  )),
  reason text,
  export_payload jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  scheduled_for timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz
);

CREATE TABLE IF NOT EXISTS data_retention_policies (
  data_category text PRIMARY KEY,
  retention_days integer NOT NULL CHECK (retention_days >= 0),
  description text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_legal_holds (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  created_by uuid REFERENCES users(id),
  expires_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recovery_token_expiry_idx
  ON account_recovery_tokens(expires_at) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS mfa_challenge_expiry_idx
  ON mfa_login_challenges(expires_at) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS privacy_request_user_time_idx
  ON privacy_requests(user_id,requested_at DESC);
CREATE INDEX IF NOT EXISTS privacy_deletion_due_idx
  ON privacy_requests(scheduled_for) WHERE status='scheduled';

INSERT INTO data_retention_policies (data_category,retention_days,description) VALUES
  ('authentication-events',365,'Eventos de autenticação e segurança.'),
  ('economic-ledger',3650,'Registros contábeis necessários à integridade do mundo virtual.'),
  ('market-integrity',1825,'Eventos de prevenção a fraude e manipulação.'),
  ('presence',30,'Dados transitórios de presença no mundo virtual.'),
  ('notifications',365,'Notificações do usuário.'),
  ('privacy-requests',1825,'Comprovantes de atendimento aos direitos do usuário.')
ON CONFLICT (data_category) DO UPDATE SET
  retention_days=EXCLUDED.retention_days,
  description=EXCLUDED.description,
  updated_at=now();

INSERT INTO user_consents (user_id,purpose,version,status,source)
SELECT id,'essential-processing','2026-07','granted','migration'
FROM users
ON CONFLICT (user_id,purpose) DO NOTHING;

COMMIT;
