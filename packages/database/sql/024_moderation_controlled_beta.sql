BEGIN;

ALTER TABLE trust_reports
  ADD COLUMN IF NOT EXISTS first_response_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz;

CREATE TABLE IF NOT EXISTS moderation_sla_policies (
  priority text PRIMARY KEY
    CHECK (priority IN ('low','normal','high','critical')),
  first_response_minutes integer NOT NULL CHECK (first_response_minutes > 0),
  resolution_minutes integer NOT NULL CHECK (resolution_minutes > 0),
  escalation_minutes integer NOT NULL CHECK (escalation_minutes > 0),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO moderation_sla_policies (
  priority,first_response_minutes,resolution_minutes,escalation_minutes
) VALUES
  ('critical',15,240,10),
  ('high',60,1440,30),
  ('normal',480,4320,240),
  ('low',1440,10080,720)
ON CONFLICT (priority) DO NOTHING;

CREATE OR REPLACE FUNCTION trust_report_apply_sla()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE policy moderation_sla_policies%ROWTYPE;
BEGIN
  SELECT * INTO policy FROM moderation_sla_policies WHERE priority=NEW.priority;
  IF policy.priority IS NULL THEN
    RAISE EXCEPTION 'Política de SLA ausente para prioridade %',NEW.priority;
  END IF;

  IF TG_OP='INSERT' THEN
    NEW.first_response_due_at := COALESCE(
      NEW.first_response_due_at,
      COALESCE(NEW.created_at,now()) + make_interval(mins=>policy.first_response_minutes)
    );
    NEW.resolution_due_at := COALESCE(
      NEW.resolution_due_at,
      COALESCE(NEW.created_at,now()) + make_interval(mins=>policy.resolution_minutes)
    );
  ELSIF NEW.priority IS DISTINCT FROM OLD.priority THEN
    NEW.first_response_due_at :=
      COALESCE(NEW.created_at,now()) + make_interval(mins=>policy.first_response_minutes);
    NEW.resolution_due_at :=
      COALESCE(NEW.created_at,now()) + make_interval(mins=>policy.resolution_minutes);
    NEW.escalated_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trust_reports_apply_sla_trigger ON trust_reports;
CREATE TRIGGER trust_reports_apply_sla_trigger
BEFORE INSERT OR UPDATE OF priority ON trust_reports
FOR EACH ROW EXECUTE FUNCTION trust_report_apply_sla();

UPDATE trust_reports report SET
  first_response_due_at=COALESCE(
    report.first_response_due_at,
    report.created_at+make_interval(mins=>policy.first_response_minutes)
  ),
  resolution_due_at=COALESCE(
    report.resolution_due_at,
    report.created_at+make_interval(mins=>policy.resolution_minutes)
  )
FROM moderation_sla_policies policy
WHERE policy.priority=report.priority
  AND (report.first_response_due_at IS NULL OR report.resolution_due_at IS NULL);

CREATE TABLE IF NOT EXISTS moderation_assignments (
  report_id uuid PRIMARY KEY REFERENCES trust_reports(id) ON DELETE CASCADE,
  assigned_to uuid NOT NULL REFERENCES users(id),
  assigned_by uuid NOT NULL REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  released_at timestamptz,
  release_reason text
);

CREATE INDEX IF NOT EXISTS moderation_assignments_moderator_idx
  ON moderation_assignments(assigned_to,assigned_at DESC)
  WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS moderation_actions (
  id uuid PRIMARY KEY,
  action_key text NOT NULL UNIQUE,
  report_id uuid REFERENCES trust_reports(id) ON DELETE SET NULL,
  subject_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  subject_reference text,
  action_type text NOT NULL
    CHECK (action_type IN ('warning','restrict-economy','suspend-account','remove-content','no-action')),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','revoked','expired','completed')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  previous_beta_access text,
  previous_beta_activation_state text,
  previous_economic_status text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS moderation_actions_subject_idx
  ON moderation_actions(subject_user_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS moderation_appeals (
  id uuid PRIMARY KEY,
  appeal_key text NOT NULL UNIQUE,
  action_id uuid NOT NULL REFERENCES moderation_actions(id) ON DELETE CASCADE,
  appellant_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  statement bytea NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in-review','upheld','denied','withdrawn')),
  reviewer_id uuid REFERENCES users(id),
  decision_note text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (action_id,appellant_user_id)
);

CREATE INDEX IF NOT EXISTS moderation_appeals_queue_idx
  ON moderation_appeals(status,created_at)
  WHERE status IN ('pending','in-review');

CREATE TABLE IF NOT EXISTS moderation_shifts (
  id uuid PRIMARY KEY,
  moderator_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','active','completed','cancelled')),
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS moderation_shifts_coverage_idx
  ON moderation_shifts(starts_at,ends_at,status);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS beta_activation_state text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS beta_activation_updated_at timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='users_beta_activation_state_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_beta_activation_state_check
      CHECK (beta_activation_state IN ('pending','active','paused','revoked'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS beta_rollout_control (
  control_key text PRIMARY KEY,
  mode text NOT NULL DEFAULT 'controlled'
    CHECK (mode IN ('open','controlled','closed')),
  status text NOT NULL DEFAULT 'paused'
    CHECK (status IN ('paused','running','rollback','closed')),
  kill_switch boolean NOT NULL DEFAULT false,
  active_wave_id uuid,
  thresholds jsonb NOT NULL DEFAULT
    '{"maxErrorRatePercent":2,"maxP95LatencyMs":1200,"maxCriticalReports":0}'::jsonb,
  reason text,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO beta_rollout_control (control_key,mode,status,kill_switch)
VALUES ('public-beta','controlled','paused',false)
ON CONFLICT (control_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS beta_rollout_waves (
  id uuid PRIMARY KEY,
  wave_key text NOT NULL UNIQUE,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','active','paused','completed','rolled-back','cancelled')),
  target_percent integer NOT NULL CHECK (target_percent BETWEEN 1 AND 100),
  max_activations integer NOT NULL CHECK (max_activations > 0),
  eligibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  thresholds jsonb NOT NULL DEFAULT '{}'::jsonb,
  starts_at timestamptz,
  ends_at timestamptz,
  activated_at timestamptz,
  completed_at timestamptz,
  rollback_reason text,
  created_by uuid NOT NULL REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS beta_rollout_waves_status_idx
  ON beta_rollout_waves(status,created_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='beta_rollout_control_active_wave_fk'
  ) THEN
    ALTER TABLE beta_rollout_control
      ADD CONSTRAINT beta_rollout_control_active_wave_fk
      FOREIGN KEY (active_wave_id) REFERENCES beta_rollout_waves(id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS beta_wave_members (
  wave_id uuid NOT NULL REFERENCES beta_rollout_waves(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','paused','revoked','completed')),
  previous_activation_state text
    CHECK (previous_activation_state IS NULL OR previous_activation_state IN ('pending','active','paused','revoked')),
  enrolled_by uuid NOT NULL REFERENCES users(id),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  paused_at timestamptz,
  revoked_at timestamptz,
  PRIMARY KEY (wave_id,user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS beta_wave_members_active_user_idx
  ON beta_wave_members(user_id)
  WHERE status IN ('pending','active','paused');

CREATE TABLE IF NOT EXISTS beta_rollout_observations (
  id uuid PRIMARY KEY,
  wave_id uuid REFERENCES beta_rollout_waves(id) ON DELETE SET NULL,
  error_rate_percent numeric(8,4) NOT NULL CHECK (error_rate_percent >= 0),
  p95_latency_ms integer NOT NULL CHECK (p95_latency_ms >= 0),
  critical_reports integer NOT NULL CHECK (critical_reports >= 0),
  active_users integer NOT NULL CHECK (active_users >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_by uuid NOT NULL REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS beta_rollout_observations_wave_idx
  ON beta_rollout_observations(wave_id,recorded_at DESC);

CREATE TABLE IF NOT EXISTS beta_rollout_events (
  id uuid PRIMARY KEY,
  wave_id uuid REFERENCES beta_rollout_waves(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  previous_status text,
  status text NOT NULL,
  reason text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO release_gate_checks (gate_key,label,status,evidence,notes) VALUES
  ('moderation-sla-coverage','Cobertura de moderação e SLA','pending','{}'::jsonb,
    'Exige cobertura contínua das próximas 24 horas e ausência de denúncias críticas vencidas.'),
  ('controlled-beta-wave-prepared','Onda controlada de beta preparada','pending','{}'::jsonb,
    'Exige membros elegíveis, limites explícitos, aprovação independente e kill switch disponível.')
ON CONFLICT (gate_key) DO NOTHING;

COMMIT;
