BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verification_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_verification_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS public_beta_access text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS beta_access_updated_at timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='users_public_beta_access_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_public_beta_access_check
      CHECK (public_beta_access IN ('pending','invited','active','suspended'));
  END IF;
END $$;

UPDATE users SET
  email_verified_at=COALESCE(email_verified_at,now()),
  email_verification_required=false,
  public_beta_access=CASE WHEN status='active' THEN 'active' ELSE 'suspended' END,
  beta_access_updated_at=now();

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  requested_ip_hash text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx
  ON email_verification_tokens (user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS email_verification_tokens_active_idx
  ON email_verification_tokens (expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS beta_invites (
  id uuid PRIMARY KEY,
  code_hash text NOT NULL UNIQUE,
  label text NOT NULL,
  email_pattern text,
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','exhausted','revoked')),
  expires_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS beta_invite_redemptions (
  id uuid PRIMARY KEY,
  invite_id uuid NOT NULL REFERENCES beta_invites(id),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  email text NOT NULL,
  redeemed_ip_hash text,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invite_id,user_id)
);

CREATE INDEX IF NOT EXISTS beta_invites_active_idx
  ON beta_invites (status,expires_at,created_at DESC);

CREATE TABLE IF NOT EXISTS transactional_email_outbox (
  id uuid PRIMARY KEY,
  delivery_key text NOT NULL UNIQUE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  recipient text NOT NULL,
  template text NOT NULL,
  subject text NOT NULL,
  payload_ciphertext bytea NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sending','sent','failed','dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  provider_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS transactional_email_due_idx
  ON transactional_email_outbox (next_attempt_at,created_at)
  WHERE status IN ('queued','failed');
CREATE INDEX IF NOT EXISTS transactional_email_user_idx
  ON transactional_email_outbox (user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS release_gate_checks (
  gate_key text PRIMARY KEY,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','passing','blocked','waived')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  checked_at timestamptz,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO release_gate_checks (gate_key,label,status) VALUES
  ('transactional-email','Entrega transacional de e-mail','pending'),
  ('email-verification','Verificação obrigatória de e-mail','pending'),
  ('browser-e2e','Testes E2E de navegador','pending'),
  ('accessibility','Validação de acessibilidade','pending'),
  ('load-smoke','Teste de carga de release','pending'),
  ('security-review','Revisão independente de segurança','pending'),
  ('privacy-review','Revisão LGPD e privacidade','pending'),
  ('terms-approved','Termos e política publicados','pending'),
  ('incident-response','Runbook de incidentes validado','pending')
ON CONFLICT (gate_key) DO NOTHING;

COMMIT;
