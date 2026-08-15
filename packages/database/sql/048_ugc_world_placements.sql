BEGIN;

CREATE TABLE IF NOT EXISTS ugc_world_placements (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_upload_id uuid NOT NULL REFERENCES ugc_binary_asset_upload_sessions(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES city_locations(id) ON DELETE RESTRICT,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  offset_x smallint NOT NULL DEFAULT 0 CHECK (offset_x BETWEEN -120 AND 120),
  offset_y smallint NOT NULL DEFAULT -70 CHECK (offset_y BETWEEN -140 AND 80),
  scale_percent smallint NOT NULL DEFAULT 100 CHECK (scale_percent BETWEEN 50 AND 180),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ugc_world_placements_location_active_idx
  ON ugc_world_placements(location_id,created_at DESC)
  WHERE status='active';

CREATE INDEX IF NOT EXISTS ugc_world_placements_owner_idx
  ON ugc_world_placements(owner_user_id,status,created_at DESC);

CREATE OR REPLACE FUNCTION enforce_ugc_world_placement_asset()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  asset_owner uuid;
  asset_status text;
  asset_content_type text;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  SELECT owner_user_id,status,content_type
    INTO asset_owner,asset_status,asset_content_type
  FROM ugc_binary_asset_upload_sessions
  WHERE id=NEW.asset_upload_id;

  IF asset_owner IS NULL THEN
    RAISE EXCEPTION 'UGC placement asset does not exist';
  END IF;
  IF asset_owner <> NEW.owner_user_id THEN
    RAISE EXCEPTION 'UGC placement asset must belong to placement owner';
  END IF;
  IF asset_status <> 'clean' THEN
    RAISE EXCEPTION 'UGC placement asset must be clean';
  END IF;
  IF asset_content_type NOT IN ('image/png','image/jpeg','image/webp') THEN
    RAISE EXCEPTION 'UGC placement renderer currently accepts clean image assets only';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ugc_world_placements_clean_asset_trg ON ugc_world_placements;
CREATE TRIGGER ugc_world_placements_clean_asset_trg
BEFORE INSERT OR UPDATE OF owner_user_id,asset_upload_id,status
ON ugc_world_placements
FOR EACH ROW
EXECUTE FUNCTION enforce_ugc_world_placement_asset();

COMMIT;

-- World placement is fail-closed: only the owner's clean image assets can become visible runtime objects.
-- Tehkné Solutions
