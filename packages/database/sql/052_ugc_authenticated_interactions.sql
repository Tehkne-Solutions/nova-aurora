BEGIN;

CREATE TABLE IF NOT EXISTS ugc_world_placement_interactions (
  id uuid PRIMARY KEY,
  placement_id uuid NOT NULL REFERENCES ugc_world_placements(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  previous_animation_state text NOT NULL CHECK (previous_animation_state IN ('idle','open','close','activate','deactivate','spin')),
  requested_animation_state text NOT NULL CHECK (requested_animation_state IN ('idle','open','close','activate','deactivate','spin')),
  interaction_source text NOT NULL DEFAULT 'authenticated-visitor' CHECK (interaction_source='authenticated-visitor'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ugc_world_placement_interactions_actor_cooldown_idx
  ON ugc_world_placement_interactions(placement_id,actor_user_id,created_at DESC);

CREATE INDEX IF NOT EXISTS ugc_world_placement_interactions_audit_idx
  ON ugc_world_placement_interactions(placement_id,created_at DESC);

COMMIT;

-- Authenticated UGC interactions are auditable and fail-closed; authorization remains on the placement interaction_scope.
-- Tehkné Solutions
