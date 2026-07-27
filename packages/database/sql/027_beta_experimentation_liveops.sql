BEGIN;

CREATE TABLE IF NOT EXISTS beta_experiments (
  id uuid PRIMARY KEY,
  experiment_key text NOT NULL UNIQUE CHECK (experiment_key ~ '^[a-z0-9][a-z0-9._-]{2,79}$'),
  flag_id uuid NOT NULL REFERENCES beta_feature_flags(id) ON DELETE RESTRICT,
  label text NOT NULL,
  hypothesis text NOT NULL,
  decision_question text NOT NULL,
  primary_metric text NOT NULL CHECK (primary_metric IN ('conversion','retention-d1','retention-d7','feedback','engagement','economy')),
  secondary_metrics text[] NOT NULL DEFAULT '{}'::text[],
  guardrails jsonb NOT NULL DEFAULT '{}'::jsonb,
  minimum_sample integer NOT NULL DEFAULT 50 CHECK (minimum_sample BETWEEN 10 AND 1000000),
  minimum_runtime_hours integer NOT NULL DEFAULT 168 CHECK (minimum_runtime_hours BETWEEN 1 AND 8760),
  minimum_lift_percent numeric(8,4) NOT NULL DEFAULT 5 CHECK (minimum_lift_percent BETWEEN 0 AND 1000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','running','paused','completed','cancelled')),
  starts_at timestamptz,
  ends_at timestamptz,
  started_at timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS beta_experiments_status_idx ON beta_experiments(status,starts_at,created_at DESC);
CREATE INDEX IF NOT EXISTS beta_experiments_flag_idx ON beta_experiments(flag_id,created_at DESC);

CREATE TABLE IF NOT EXISTS beta_experiment_approvals (
  experiment_id uuid NOT NULL REFERENCES beta_experiments(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  decision text NOT NULL CHECK (decision IN ('approve','reject')),
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (experiment_id,actor_id)
);

CREATE TABLE IF NOT EXISTS beta_experiment_results (
  id uuid PRIMARY KEY,
  experiment_id uuid NOT NULL REFERENCES beta_experiments(id) ON DELETE CASCADE,
  variant text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  exposed_users integer NOT NULL CHECK (exposed_users >= 0),
  active_users integer NOT NULL CHECK (active_users >= 0),
  eligible_d1 integer NOT NULL DEFAULT 0 CHECK (eligible_d1 >= 0),
  eligible_d7 integer NOT NULL DEFAULT 0 CHECK (eligible_d7 >= 0),
  retention_d1_percent numeric(8,4) NOT NULL DEFAULT 0,
  retention_d7_percent numeric(8,4) NOT NULL DEFAULT 0,
  conversion_percent numeric(8,4) NOT NULL DEFAULT 0,
  error_rate_percent numeric(8,4) NOT NULL DEFAULT 0,
  average_session_minutes numeric(12,4) NOT NULL DEFAULT 0,
  average_feedback_score numeric(8,4) NOT NULL DEFAULT 0,
  critical_feedback integer NOT NULL DEFAULT 0 CHECK (critical_feedback >= 0),
  support_tickets integer NOT NULL DEFAULT 0 CHECK (support_tickets >= 0),
  support_sla_breaches integer NOT NULL DEFAULT 0 CHECK (support_sla_breaches >= 0),
  economy_stability_score numeric(8,4) NOT NULL DEFAULT 100,
  primary_metric_value numeric(14,6) NOT NULL DEFAULT 0,
  recommendation text NOT NULL CHECK (recommendation IN ('expand','hold','reduce','stop')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id,variant,period_start,period_end)
);
CREATE INDEX IF NOT EXISTS beta_experiment_results_experiment_idx ON beta_experiment_results(experiment_id,period_end DESC,variant);

CREATE TABLE IF NOT EXISTS beta_experiment_decisions (
  id uuid PRIMARY KEY,
  experiment_id uuid NOT NULL REFERENCES beta_experiments(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('expand','hold','reduce','stop')),
  rationale text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS beta_experiment_decisions_idx ON beta_experiment_decisions(experiment_id,created_at DESC);

CREATE TABLE IF NOT EXISTS beta_liveops_events (
  id uuid PRIMARY KEY,
  event_key text NOT NULL UNIQUE,
  experiment_id uuid REFERENCES beta_experiments(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('experiment-start','experiment-review','experiment-pause','experiment-complete','communication','maintenance','incident')),
  title text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','completed','cancelled')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','success','warning','critical')),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS beta_liveops_events_calendar_idx ON beta_liveops_events(starts_at,status,severity);

INSERT INTO release_gate_checks (gate_key,label,status,evidence,notes) VALUES (
  'beta-experimentation-ready','Experimentação e LiveOps preparados','pending','{}'::jsonb,
  'Exige experimento aprovado com amostra, guardrails, calendário e decisão humana auditável.'
) ON CONFLICT (gate_key) DO NOTHING;

COMMIT;
