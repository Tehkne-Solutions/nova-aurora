BEGIN;

CREATE TABLE IF NOT EXISTS creator_channel_follows (
  channel_id uuid NOT NULL REFERENCES creator_channels(id) ON DELETE CASCADE,
  follower_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(channel_id, follower_user_id)
);

CREATE INDEX IF NOT EXISTS creator_channel_follows_follower_idx
  ON creator_channel_follows(follower_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS creator_content_reactions (
  content_id uuid NOT NULL REFERENCES creator_content(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction text NOT NULL DEFAULT 'like' CHECK (reaction IN ('like')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(content_id, user_id, reaction)
);

CREATE INDEX IF NOT EXISTS creator_content_reactions_user_idx
  ON creator_content_reactions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS creator_content_views (
  id uuid PRIMARY KEY,
  content_id uuid NOT NULL REFERENCES creator_content(id) ON DELETE CASCADE,
  viewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creator_content_views_content_idx
  ON creator_content_views(content_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS creator_content_views_viewer_idx
  ON creator_content_views(viewer_user_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS economy_ad_events (
  id uuid PRIMARY KEY,
  placement_id uuid NOT NULL REFERENCES economy_ad_placements(id) ON DELETE CASCADE,
  viewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('impression','click')),
  idempotency_key text NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS economy_ad_events_placement_idx
  ON economy_ad_events(placement_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS economy_ad_events_viewer_idx
  ON economy_ad_events(viewer_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS economy_ad_events_type_idx
  ON economy_ad_events(event_type, occurred_at DESC);

COMMIT;

-- Tehkné Solutions
