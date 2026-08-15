BEGIN;

CREATE TABLE IF NOT EXISTS ugc_managed_manifests (
  upload_id uuid PRIMARY KEY REFERENCES ugc_asset_upload_sessions(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  asset_count integer NOT NULL CHECK (asset_count BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ugc_managed_manifest_assets (
  manifest_upload_id uuid NOT NULL REFERENCES ugc_managed_manifests(upload_id) ON DELETE CASCADE,
  asset_upload_id uuid NOT NULL REFERENCES ugc_binary_asset_upload_sessions(id) ON DELETE RESTRICT,
  asset_role text NOT NULL CHECK (asset_role IN ('model','texture','thumbnail','preview','attachment')),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 63),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (manifest_upload_id,asset_upload_id),
  UNIQUE (manifest_upload_id,ordinal)
);

CREATE INDEX IF NOT EXISTS ugc_managed_manifests_owner_idx
  ON ugc_managed_manifests(owner_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS ugc_managed_manifest_assets_asset_idx
  ON ugc_managed_manifest_assets(asset_upload_id);

CREATE OR REPLACE FUNCTION enforce_managed_manifest_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  manifest_owner uuid;
  manifest_status text;
BEGIN
  SELECT owner_user_id,status
    INTO manifest_owner,manifest_status
  FROM ugc_asset_upload_sessions
  WHERE id=NEW.upload_id;

  IF manifest_status IS NULL OR manifest_status <> 'verified' THEN
    RAISE EXCEPTION 'Managed UGC manifest requires a verified manifest upload';
  END IF;
  IF manifest_owner IS DISTINCT FROM NEW.owner_user_id THEN
    RAISE EXCEPTION 'Managed UGC manifest owner must match verified upload owner';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ugc_managed_manifest_integrity_trg ON ugc_managed_manifests;
CREATE TRIGGER ugc_managed_manifest_integrity_trg
BEFORE INSERT OR UPDATE OF upload_id,owner_user_id
ON ugc_managed_manifests
FOR EACH ROW
EXECUTE FUNCTION enforce_managed_manifest_integrity();

CREATE OR REPLACE FUNCTION enforce_managed_manifest_asset_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  manifest_owner uuid;
  asset_owner uuid;
  asset_status text;
BEGIN
  SELECT owner_user_id INTO manifest_owner
  FROM ugc_managed_manifests
  WHERE upload_id=NEW.manifest_upload_id;

  SELECT owner_user_id,status INTO asset_owner,asset_status
  FROM ugc_binary_asset_upload_sessions
  WHERE id=NEW.asset_upload_id;

  IF manifest_owner IS NULL THEN
    RAISE EXCEPTION 'Managed UGC manifest does not exist';
  END IF;
  IF asset_status IS NULL OR asset_status <> 'clean' THEN
    RAISE EXCEPTION 'Managed UGC manifest can reference only clean binary assets';
  END IF;
  IF asset_owner IS DISTINCT FROM manifest_owner THEN
    RAISE EXCEPTION 'Managed UGC manifest can reference only assets owned by the same creator';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ugc_managed_manifest_asset_integrity_trg ON ugc_managed_manifest_assets;
CREATE TRIGGER ugc_managed_manifest_asset_integrity_trg
BEFORE INSERT OR UPDATE OF manifest_upload_id,asset_upload_id
ON ugc_managed_manifest_assets
FOR EACH ROW
EXECUTE FUNCTION enforce_managed_manifest_asset_integrity();

COMMIT;

-- Managed manifests are platform-authored provenance documents over clean, same-owner creator assets only.
-- Tehkné Solutions
