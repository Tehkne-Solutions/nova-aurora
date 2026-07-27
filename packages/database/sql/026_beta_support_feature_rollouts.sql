BEGIN;

CREATE TABLE IF NOT EXISTS beta_support_tickets (
  id uuid PRIMARY KEY,
  ticket_key text NOT NULL UNIQUE,
  submission_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wave_id uuid REFERENCES beta_rollout_waves(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (category IN (
    'account','technical','gameplay','economy','safety','privacy','other'
  )),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','critical')),
  subject text NOT NULL,
  details bytea NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN (
      'open','acknowledged','in-progress','waiting-user','resolved','closed'
    )),
  assigned_to uuid REFERENCES users(id),
  first_response_due_at timestamptz NOT NULL,
  resolution_due_at timestamptz NOT NULL,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, submission_key)
);

CREATE INDEX IF NOT EXISTS beta_support_ticket_queue_idx
  ON beta_support_tickets(priority, status, created_at DESC);

CREATE INDEX IF NOT EXISTS beta_support_ticket_sla_idx
  ON beta_support_tickets(first_response_due_at, resolution_due_at)
  WHERE status NOT IN ('resolved','closed');

CREATE INDEX IF NOT EXISTS beta_support_ticket_user_idx
  ON beta_support_tickets(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS beta_support_updates (
  id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES beta_support_tickets(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK (status IN (
    'open','acknowledged','in-progress','waiting-user','resolved','closed'
  )),
  message bytea NOT NULL,
  visible_to_user boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS beta_support_updates_ticket_idx
  ON beta_support_updates(ticket_id, created_at, id);

CREATE TABLE IF NOT EXISTS beta_feature_flags (
  id uuid PRIMARY KEY,
  flag_key text NOT NULL UNIQUE
    CHECK (flag_key ~ '^[a-z0-9][a-z0-9._-]{2,79}$'),
  label text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','ready','active','paused','retired')),
  default_variant text NOT NULL,
  variants jsonb NOT NULL,
  rollout_percent integer NOT NULL DEFAULT 0
    CHECK (rollout_percent BETWEEN 0 AND 100),
  target_wave_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  safety_thresholds jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  activated_at timestamptz,
  paused_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS beta_feature_flags_status_idx
  ON beta_feature_flags(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS beta_feature_flag_approvals (
  flag_id uuid NOT NULL REFERENCES beta_feature_flags(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  decision text NOT NULL CHECK (decision IN ('approve','reject')),
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (flag_id, actor_id)
);

CREATE TABLE IF NOT EXISTS beta_feature_exposures (
  id uuid PRIMARY KEY,
  flag_id uuid NOT NULL REFERENCES beta_feature_flags(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wave_id uuid REFERENCES beta_rollout_waves(id) ON DELETE SET NULL,
  variant text NOT NULL,
  bucket integer NOT NULL CHECK (bucket BETWEEN 0 AND 9999),
  exposed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flag_id, user_id)
);

CREATE INDEX IF NOT EXISTS beta_feature_exposures_flag_idx
  ON beta_feature_exposures(flag_id, variant, exposed_at DESC);

INSERT INTO release_gate_checks (gate_key,label,status,evidence,notes) VALUES
  (
    'beta-support-sla-operational',
    'Suporte do beta dentro do SLA',
    'pending',
    '{}'::jsonb,
    'Exige ausência de tickets críticos abertos e violações de primeira resposta ou resolução.'
  ),
  (
    'feature-rollout-prepared',
    'Rollout de funcionalidades preparado',
    'pending',
    '{}'::jsonb,
    'Exige ao menos uma flag pronta ou ativa com duas aprovações independentes.'
  )
ON CONFLICT (gate_key) DO NOTHING;

COMMIT;
