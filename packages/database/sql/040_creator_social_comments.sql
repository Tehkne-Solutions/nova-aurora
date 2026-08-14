BEGIN;

CREATE TABLE IF NOT EXISTS creator_user_blocks (
  blocker_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  CHECK (blocker_user_id <> blocked_user_id)
);

CREATE INDEX IF NOT EXISTS creator_user_blocks_blocked_idx
  ON creator_user_blocks(blocked_user_id, blocker_user_id);

CREATE TABLE IF NOT EXISTS creator_content_comments (
  id uuid PRIMARY KEY,
  content_id uuid NOT NULL REFERENCES creator_content(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK ((status = 'deleted' AND deleted_at IS NOT NULL) OR status <> 'deleted')
);

CREATE INDEX IF NOT EXISTS creator_content_comments_content_idx
  ON creator_content_comments(content_id, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS creator_content_comments_author_idx
  ON creator_content_comments(author_user_id, status, created_at DESC);

ALTER TABLE creator_economy_reports
  DROP CONSTRAINT IF EXISTS creator_economy_reports_resource_type_check;
ALTER TABLE creator_economy_reports
  ADD CONSTRAINT creator_economy_reports_resource_type_check
  CHECK (resource_type IN (
    'creator_content','creator_channel','creator_comment','ugc_blueprint','ad_campaign','ad_surface','competition'
  ));

COMMIT;

-- Tehkné Solutions
