BEGIN;

CREATE TABLE IF NOT EXISTS beta_product_events (
  id UUID PRIMARY KEY,
  client_event_id TEXT NOT NULL UNIQUE,
  event_key TEXT NOT NULL CHECK (event_key ~ '^[a-z0-9][a-z0-9._-]{2,79}$'),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id UUID,
  wave_id UUID REFERENCES beta_rollout_waves(id) ON DELETE SET NULL,
  route TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version BETWEEN 1 AND 20),
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS beta_product_events_time_idx
  ON beta_product_events(event_key, occurred_at DESC);
CREATE INDEX IF NOT EXISTS beta_product_events_user_idx
  ON beta_product_events(user_id, occurred_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS beta_product_events_wave_idx
  ON beta_product_events(wave_id, occurred_at DESC)
  WHERE wave_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS beta_feedback_items (
  id UUID PRIMARY KEY,
  feedback_key TEXT NOT NULL UNIQUE,
  submission_key TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'gameplay','economy','usability','performance','accessibility','trust','other'
  )),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  summary TEXT NOT NULL,
  details BYTEA NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','reviewed','planned','closed','dismissed')),
  assigned_to UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS beta_feedback_queue_idx
  ON beta_feedback_items(status, created_at DESC);

CREATE TABLE IF NOT EXISTS beta_support_tickets (
  id UUID PRIMARY KEY,
  ticket_key TEXT NOT NULL UNIQUE,
  submission_key TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'account','billing-internal','gameplay','economy','technical','safety','privacy','other'
  )),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','critical')),
  subject TEXT NOT NULL,
  details BYTEA NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','acknowledged','in-progress','waiting-user','resolved','closed')),
  assigned_to UUID REFERENCES users(id),
  first_response_due_at TIMESTAMPTZ NOT NULL,
  resolution_due_at TIMESTAMPTZ NOT NULL,
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS beta_support_sla_idx
  ON beta_support_tickets(status, first_response_due_at, resolution_due_at)
  WHERE status NOT IN ('resolved','closed');
CREATE INDEX IF NOT EXISTS beta_support_user_idx
  ON beta_support_tickets(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS beta_support_updates (
  id UUID PRIMARY KEY,
  ticket_id UUID NOT NULL REFERENCES beta_support_tickets(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL,
  message BYTEA NOT NULL,
  visible_to_user BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS beta_support_updates_ticket_idx
  ON beta_support_updates(ticket_id, created_at);

CREATE TABLE IF NOT EXISTS beta_feature_flags (
  id UUID PRIMARY KEY,
  flag_key TEXT NOT NULL UNIQUE CHECK (flag_key ~ '^[a-z0-9][a-z0-9._-]{2,79}$'),
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','ready','active','paused','retired')),
  default_variant TEXT NOT NULL,
  variants JSONB NOT NULL,
  rollout_percent INTEGER NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  target_wave_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  safety_thresholds JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID NOT NULL REFERENCES users(id),
  activated_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS beta_feature_flag_approvals (
  flag_id UUID NOT NULL REFERENCES beta_feature_flags(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK (decision IN ('approve','reject')),
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (flag_id, actor_id)
);

CREATE TABLE IF NOT EXISTS beta_feature_exposures (
  id UUID PRIMARY KEY,
  flag_id UUID NOT NULL REFERENCES beta_feature_flags(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wave_id UUID REFERENCES beta_rollout_waves(id) ON DELETE SET NULL,
  variant TEXT NOT NULL,
  bucket INTEGER NOT NULL CHECK (bucket BETWEEN 0 AND 9999),
  exposed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (flag_id, user_id)
);

CREATE INDEX IF NOT EXISTS beta_feature_exposures_flag_idx
  ON beta_feature_exposures(flag_id, variant, exposed_at DESC);

INSERT INTO release_gate_checks (gate_key,label,status,evidence,notes)
VALUES
  (
    'product-telemetry-operational',
    'Telemetria de produto operacional',
    'pending',
    '{}'::jsonb,
    'Exige eventos válidos recentes sem coleta de campos sensíveis.'
  ),
  (
    'beta-support-sla-operational',
    'Suporte do beta dentro do SLA',
    'pending',
    '{}'::jsonb,
    'Exige ausência de tickets críticos abertos e violações de SLA.'
  ),
  (
    'feature-rollout-prepared',
    'Rollout de funcionalidades preparado',
    'pending',
    '{}'::jsonb,
    'Exige flag pronta ou ativa com duas aprovações independentes.'
  )
ON CONFLICT (gate_key) DO NOTHING;

COMMIT;
