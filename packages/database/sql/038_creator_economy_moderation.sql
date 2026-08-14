BEGIN;

CREATE TABLE IF NOT EXISTS creator_economy_reports (
  id uuid PRIMARY KEY,
  reporter_user_id uuid NOT NULL REFERENCES users(id),
  resource_type text NOT NULL CHECK (resource_type IN (
    'creator_content','creator_channel','ugc_blueprint','ad_campaign','ad_surface','competition'
  )),
  resource_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN (
    'spam','fraud','scam','harassment','hate','sexual','violence','illegal','ip','misleading_ad','unsafe_ugc','other'
  )),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 10 AND 1000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','resolved','dismissed')),
  assigned_to uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS creator_economy_reports_open_reporter_resource_uidx
  ON creator_economy_reports(reporter_user_id,resource_type,resource_id)
  WHERE status IN ('open','in_review');
CREATE INDEX IF NOT EXISTS creator_economy_reports_queue_idx
  ON creator_economy_reports(status,priority,created_at ASC);
CREATE INDEX IF NOT EXISTS creator_economy_reports_resource_idx
  ON creator_economy_reports(resource_type,resource_id,created_at DESC);
CREATE INDEX IF NOT EXISTS creator_economy_reports_reporter_idx
  ON creator_economy_reports(reporter_user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS creator_economy_moderation_actions (
  id uuid PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES creator_economy_reports(id) ON DELETE RESTRICT,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK (action IN ('claimed','dismissed','restricted')),
  previous_status text,
  next_status text,
  reason text NOT NULL CHECK (length(reason) BETWEEN 10 AND 1000),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creator_economy_moderation_actions_report_idx
  ON creator_economy_moderation_actions(report_id,occurred_at ASC,id ASC);
CREATE INDEX IF NOT EXISTS creator_economy_moderation_actions_resource_idx
  ON creator_economy_moderation_actions(resource_type,resource_id,occurred_at DESC);

COMMIT;

-- Tehkné Solutions
