ALTER TABLE ugc_world_placements
  ADD COLUMN IF NOT EXISTS rotation_y_degrees smallint NOT NULL DEFAULT 0
  CHECK (rotation_y_degrees >= 0 AND rotation_y_degrees <= 359);

CREATE OR REPLACE FUNCTION enforce_ugc_world_placement_asset()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  asset_owner uuid;
  asset_status text;
  asset_content_type text;
BEGIN
  SELECT owner_user_id,status,content_type
  INTO asset_owner,asset_status,asset_content_type
  FROM ugc_binary_asset_upload_sessions
  WHERE id=NEW.asset_upload_id;

  IF asset_owner IS NULL THEN
    RAISE EXCEPTION 'ugc placement asset not found';
  END IF;
  IF asset_owner <> NEW.owner_user_id THEN
    RAISE EXCEPTION 'ugc placement owner mismatch';
  END IF;
  IF asset_status <> 'clean' THEN
    RAISE EXCEPTION 'ugc placement requires clean asset';
  END IF;
  IF asset_content_type NOT IN (
    'image/png',
    'image/jpeg',
    'image/webp',
    'model/gltf-binary'
  ) THEN
    RAISE EXCEPTION 'ugc placement content type not renderable';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON COLUMN ugc_world_placements.rotation_y_degrees IS
  'Rotação horizontal do objeto UGC. Imagens ignoram este valor; GLB usa 0-359 graus.';

COMMENT ON FUNCTION enforce_ugc_world_placement_asset() IS
  'Fail-closed placement guard: only clean, same-owner, renderer-supported image/GLB assets may remain active.';

-- Tehkné Solutions
