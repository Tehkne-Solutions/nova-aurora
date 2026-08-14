BEGIN;

ALTER TABLE creator_economy_moderation_actions
  DROP CONSTRAINT IF EXISTS creator_economy_moderation_actions_action_check;
ALTER TABLE creator_economy_moderation_actions
  ADD CONSTRAINT creator_economy_moderation_actions_action_check
  CHECK (action IN ('claimed','dismissed','restricted','restored'));

CREATE TABLE IF NOT EXISTS creator_economy_appeals (
  id uuid PRIMARY KEY,
  report_id uuid NOT NULL UNIQUE REFERENCES creator_economy_reports(id) ON DELETE RESTRICT,
  restricted_action_id uuid NOT NULL UNIQUE REFERENCES creator_economy_moderation_actions(id) ON DELETE RESTRICT,
  appellant_user_id uuid NOT NULL REFERENCES users(id),
  reviewer_user_id uuid REFERENCES users(id),
  reason text NOT NULL CHECK (length(reason) BETWEEN 10 AND 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_review','upheld','overturned')),
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK (
    (status IN ('pending','in_review') AND resolved_at IS NULL)
    OR
    (status IN ('upheld','overturned') AND resolved_at IS NOT NULL AND decision_reason IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS creator_economy_appeals_queue_idx
  ON creator_economy_appeals(status,created_at ASC,id ASC);
CREATE INDEX IF NOT EXISTS creator_economy_appeals_appellant_idx
  ON creator_economy_appeals(appellant_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS creator_economy_appeals_reviewer_idx
  ON creator_economy_appeals(reviewer_user_id,status,created_at ASC);

CREATE TABLE IF NOT EXISTS creator_economy_appeal_actions (
  id uuid PRIMARY KEY,
  appeal_id uuid NOT NULL REFERENCES creator_economy_appeals(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK (action IN ('filed','claimed','upheld','overturned')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 10 AND 1000),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creator_economy_appeal_actions_appeal_idx
  ON creator_economy_appeal_actions(appeal_id,occurred_at ASC,id ASC);

COMMIT;

-- Tehkné Solutions
