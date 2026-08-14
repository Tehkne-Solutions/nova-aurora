BEGIN;

CREATE TABLE IF NOT EXISTS creator_social_rate_buckets (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  window_seconds integer NOT NULL CHECK (window_seconds BETWEEN 1 AND 86400),
  bucket_start timestamptz NOT NULL,
  accepted_count integer NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, action, window_seconds, bucket_start)
);

CREATE INDEX IF NOT EXISTS creator_social_rate_buckets_cleanup_idx
  ON creator_social_rate_buckets(bucket_start ASC);

CREATE TABLE IF NOT EXISTS creator_social_rate_violations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  window_seconds integer NOT NULL CHECK (window_seconds BETWEEN 1 AND 86400),
  limit_count integer NOT NULL CHECK (limit_count > 0),
  observed_count integer NOT NULL CHECK (observed_count >= limit_count),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creator_social_rate_violations_user_idx
  ON creator_social_rate_violations(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS creator_social_rate_violations_action_idx
  ON creator_social_rate_violations(action, occurred_at DESC);

COMMIT;

-- Tehkné Solutions
