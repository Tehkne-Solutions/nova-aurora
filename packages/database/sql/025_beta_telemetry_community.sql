BEGIN;

CREATE TABLE IF NOT EXISTS beta_telemetry_events (
  id uuid PRIMARY KEY,
  event_key text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wave_id uuid REFERENCES beta_rollout_waves(id) ON DELETE SET NULL,
  event_type text NOT NULL
    CHECK (event_type IN (
      'session-start',
      'session-end',
      'feature-used',
      'task-completed',
      'error',
      'performance',
      'conversion'
    )),
  session_id uuid,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  numeric_value numeric,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS beta_telemetry_events_wave_time_idx
  ON beta_telemetry_events(wave_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS beta_telemetry_events_user_time_idx
  ON beta_telemetry_events(user_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS beta_feedback (
  id uuid PRIMARY KEY,
  feedback_key text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wave_id uuid REFERENCES beta_rollout_waves(id) ON DELETE SET NULL,
  category text NOT NULL
    CHECK (category IN (
      'bug',
      'usability',
      'economy',
      'performance',
      'safety',
      'content',
      'suggestion',
      'other'
    )),
  sentiment text NOT NULL
    CHECK (sentiment IN ('negative','neutral','positive')),
  score integer NOT NULL CHECK (score BETWEEN 1 AND 5),
  summary text NOT NULL,
  details bytea NOT NULL,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','reviewing','planned','resolved','dismissed')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','critical')),
  assigned_to uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS beta_feedback_queue_idx
  ON beta_feedback(status, priority, created_at);

CREATE TABLE IF NOT EXISTS beta_feedback_updates (
  id uuid PRIMARY KEY,
  feedback_id uuid NOT NULL REFERENCES beta_feedback(id) ON DELETE CASCADE,
  status text NOT NULL,
  note text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS beta_daily_metrics (
  metric_date date NOT NULL,
  wave_id uuid NOT NULL REFERENCES beta_rollout_waves(id) ON DELETE CASCADE,
  cohort_key text NOT NULL,
  activated_users integer NOT NULL DEFAULT 0,
  active_users integer NOT NULL DEFAULT 0,
  sessions integer NOT NULL DEFAULT 0,
  average_session_minutes numeric(12,4) NOT NULL DEFAULT 0,
  retention_d1_percent numeric(8,4) NOT NULL DEFAULT 0,
  retention_d7_percent numeric(8,4) NOT NULL DEFAULT 0,
  conversion_percent numeric(8,4) NOT NULL DEFAULT 0,
  error_rate_percent numeric(8,4) NOT NULL DEFAULT 0,
  average_feedback_score numeric(8,4) NOT NULL DEFAULT 0,
  critical_feedback integer NOT NULL DEFAULT 0,
  economy_stability_score numeric(8,4) NOT NULL DEFAULT 100,
  health_score numeric(8,4) NOT NULL DEFAULT 0,
  recommendation text NOT NULL DEFAULT 'hold'
    CHECK (recommendation IN ('expand','hold','reduce')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (metric_date, wave_id, cohort_key)
);

CREATE INDEX IF NOT EXISTS beta_daily_metrics_wave_idx
  ON beta_daily_metrics(wave_id, metric_date DESC);

CREATE TABLE IF NOT EXISTS community_announcements (
  id uuid PRIMARY KEY,
  announcement_key text NOT NULL UNIQUE,
  title text NOT NULL,
  body text NOT NULL,
  audience text NOT NULL
    CHECK (audience IN ('all','beta','wave','admins')),
  wave_id uuid REFERENCES beta_rollout_waves(id) ON DELETE SET NULL,
  severity text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info','success','warning','critical')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','scheduled','published','expired','cancelled')),
  publish_at timestamptz,
  expires_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  published_by uuid REFERENCES users(id),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at IS NULL OR publish_at IS NULL OR expires_at > publish_at)
);

CREATE INDEX IF NOT EXISTS community_announcements_active_idx
  ON community_announcements(status, publish_at, expires_at);

CREATE TABLE IF NOT EXISTS community_announcement_reads (
  announcement_id uuid NOT NULL REFERENCES community_announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS beta_learning_reports (
  id uuid PRIMARY KEY,
  report_key text NOT NULL UNIQUE,
  wave_id uuid NOT NULL REFERENCES beta_rollout_waves(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),
  recommendation text NOT NULL
    CHECK (recommendation IN ('expand','hold','reduce')),
  summary text NOT NULL,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  published_by uuid REFERENCES users(id),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS beta_learning_reports_wave_idx
  ON beta_learning_reports(wave_id, period_end DESC);

INSERT INTO release_gate_checks (gate_key,label,status,evidence,notes) VALUES
  (
    'beta-community-operations-ready',
    'Comunicação e feedback do beta',
    'pending',
    '{}'::jsonb,
    'Exige anúncio operacional publicado e nenhuma manifestação crítica sem revisão.'
  )
ON CONFLICT (gate_key) DO NOTHING;

COMMIT;
