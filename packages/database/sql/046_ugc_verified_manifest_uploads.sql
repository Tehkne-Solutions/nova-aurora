BEGIN;

CREATE TABLE IF NOT EXISTS ugc_asset_upload_sessions (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key text NOT NULL UNIQUE,
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 180),
  content_type text NOT NULL DEFAULT 'application/json' CHECK (content_type='application/json'),
  expected_size_bytes bigint NOT NULL CHECK (expected_size_bytes BETWEEN 2 AND 1048576),
  declared_sha256 text NOT NULL CHECK (declared_sha256 ~ '^[0-9a-f]{64}$'),
  verified_size_bytes bigint CHECK (verified_size_bytes IS NULL OR verified_size_bytes BETWEEN 2 AND 1048576),
  verified_sha256 text CHECK (verified_sha256 IS NULL OR verified_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected','expired')),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (
    (status='verified' AND verified_at IS NOT NULL AND verified_size_bytes IS NOT NULL AND verified_sha256 IS NOT NULL)
    OR status<>'verified'
  )
);

CREATE INDEX IF NOT EXISTS ugc_asset_upload_sessions_owner_idx
  ON ugc_asset_upload_sessions(owner_user_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS ugc_asset_upload_sessions_expiry_idx
  ON ugc_asset_upload_sessions(status,expires_at)
  WHERE status='pending';

ALTER TABLE ugc_asset_manifest_registry
  ADD COLUMN IF NOT EXISTS verified_upload_id uuid
  REFERENCES ugc_asset_upload_sessions(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS ugc_asset_manifest_registry_verified_upload_uidx
  ON ugc_asset_manifest_registry(verified_upload_id)
  WHERE verified_upload_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_verified_manifest_registry_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  upload_owner uuid;
  upload_status text;
  upload_sha text;
BEGIN
  IF NEW.verified_upload_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT owner_user_id,status,verified_sha256
    INTO upload_owner,upload_status,upload_sha
  FROM ugc_asset_upload_sessions
  WHERE id=NEW.verified_upload_id;

  IF upload_status IS NULL OR upload_status <> 'verified' THEN
    RAISE EXCEPTION 'UGC manifest registry requires a verified upload session';
  END IF;
  IF upload_owner IS DISTINCT FROM NEW.owner_user_id THEN
    RAISE EXCEPTION 'Verified UGC manifest upload owner must match registry owner';
  END IF;
  IF upload_sha IS DISTINCT FROM NEW.sha256 THEN
    RAISE EXCEPTION 'Verified UGC manifest upload SHA-256 must match registry declaration';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ugc_asset_manifest_registry_verified_upload_trg ON ugc_asset_manifest_registry;
CREATE TRIGGER ugc_asset_manifest_registry_verified_upload_trg
BEFORE INSERT OR UPDATE OF owner_user_id,sha256,verified_upload_id
ON ugc_asset_manifest_registry
FOR EACH ROW
EXECUTE FUNCTION enforce_verified_manifest_registry_link();

COMMIT;

-- Uploaded manifests remain immutable object-storage evidence linked to the existing declaration registry.
-- Tehkné Solutions
