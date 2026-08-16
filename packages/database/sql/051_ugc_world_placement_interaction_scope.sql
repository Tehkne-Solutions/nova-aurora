ALTER TABLE ugc_world_placements
  ADD COLUMN IF NOT EXISTS interaction_scope text NOT NULL DEFAULT 'owner_only';

ALTER TABLE ugc_world_placements
  DROP CONSTRAINT IF EXISTS ugc_world_placements_interaction_scope_check;

ALTER TABLE ugc_world_placements
  ADD CONSTRAINT ugc_world_placements_interaction_scope_check
  CHECK (interaction_scope IN ('owner_only','authenticated'));

COMMENT ON COLUMN ugc_world_placements.interaction_scope IS
  'Fail-closed interaction permission. owner_only is default; authenticated is an explicit creator opt-in and does not itself expose a visitor mutation endpoint.';

-- Tehkné Solutions
