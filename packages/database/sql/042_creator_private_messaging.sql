BEGIN;

CREATE TABLE IF NOT EXISTS creator_dm_threads (
  id uuid PRIMARY KEY,
  user_low_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by_user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','declined','closed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  declined_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_low_id,user_high_id),
  CHECK (user_low_id < user_high_id),
  CHECK (requested_by_user_id IN (user_low_id,user_high_id)),
  CHECK ((status <> 'active') OR accepted_at IS NOT NULL),
  CHECK ((status <> 'declined') OR declined_at IS NOT NULL),
  CHECK ((status <> 'closed') OR closed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS creator_dm_threads_low_idx
  ON creator_dm_threads(user_low_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS creator_dm_threads_high_idx
  ON creator_dm_threads(user_high_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS creator_dm_participant_state (
  thread_id uuid NOT NULL REFERENCES creator_dm_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at timestamptz,
  archived_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(thread_id,user_id)
);

CREATE INDEX IF NOT EXISTS creator_dm_participant_state_user_idx
  ON creator_dm_participant_state(user_id,archived_at,updated_at DESC);

CREATE TABLE IF NOT EXISTS creator_dm_messages (
  id uuid PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES creator_dm_threads(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES users(id),
  message_kind text NOT NULL DEFAULT 'message' CHECK (message_kind IN ('request','message')),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  FOREIGN KEY(thread_id,sender_user_id)
    REFERENCES creator_dm_participant_state(thread_id,user_id) ON DELETE CASCADE,
  CHECK ((status = 'deleted' AND deleted_at IS NOT NULL) OR status <> 'deleted')
);

CREATE INDEX IF NOT EXISTS creator_dm_messages_thread_idx
  ON creator_dm_messages(thread_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS creator_dm_messages_sender_idx
  ON creator_dm_messages(sender_user_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS creator_private_moderation_access (
  id uuid PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES creator_economy_reports(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES creator_dm_messages(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (length(reason) BETWEEN 10 AND 1000),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creator_private_moderation_access_report_idx
  ON creator_private_moderation_access(report_id,occurred_at ASC,id ASC);

ALTER TABLE creator_economy_reports
  DROP CONSTRAINT IF EXISTS creator_economy_reports_resource_type_check;
ALTER TABLE creator_economy_reports
  ADD CONSTRAINT creator_economy_reports_resource_type_check
  CHECK (resource_type IN (
    'creator_content','creator_channel','creator_comment','creator_message',
    'ugc_blueprint','ad_campaign','ad_surface','competition'
  ));

COMMIT;

-- Tehkné Solutions
