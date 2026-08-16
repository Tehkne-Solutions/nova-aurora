ALTER TABLE ugc_world_placements
  ADD COLUMN IF NOT EXISTS animation_state text NOT NULL DEFAULT 'idle';

ALTER TABLE ugc_world_placements
  DROP CONSTRAINT IF EXISTS ugc_world_placements_animation_state_check;

ALTER TABLE ugc_world_placements
  ADD CONSTRAINT ugc_world_placements_animation_state_check
  CHECK (animation_state IN ('idle','open','close','activate','deactivate','spin'));

COMMENT ON COLUMN ugc_world_placements.animation_state IS
  'Estado visual canônico do objeto GLB: idle/open/close/activate/deactivate/spin. Imagens persistem idle e ignoram playback.';

-- Tehkné Solutions
