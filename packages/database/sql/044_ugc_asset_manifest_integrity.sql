BEGIN;

CREATE TABLE IF NOT EXISTS ugc_asset_manifest_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  manifest_uri text NOT NULL,
  sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'declared' CHECK (status IN ('declared','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE(owner_user_id,manifest_uri,sha256),
  CHECK (manifest_uri ~ '^https://[^[:space:]]+$'),
  CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CHECK ((status='revoked' AND revoked_at IS NOT NULL) OR status<>'revoked')
);

CREATE INDEX IF NOT EXISTS ugc_asset_manifest_registry_owner_idx
  ON ugc_asset_manifest_registry(owner_user_id,status,updated_at DESC);

ALTER TABLE ugc_object_blueprints
  ADD COLUMN IF NOT EXISTS asset_manifest_registry_id uuid
  REFERENCES ugc_asset_manifest_registry(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS ugc_object_blueprints_manifest_registry_idx
  ON ugc_object_blueprints(asset_manifest_registry_id)
  WHERE asset_manifest_registry_id IS NOT NULL;

CREATE OR REPLACE FUNCTION bind_ugc_asset_manifest_registry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  normalized_hash text;
  registry_id uuid;
BEGIN
  IF TG_OP='UPDATE'
     AND NEW.asset_manifest_uri IS NOT DISTINCT FROM OLD.asset_manifest_uri
     AND NEW.content_hash IS NOT DISTINCT FROM OLD.content_hash
  THEN
    RETURN NEW;
  END IF;

  IF NEW.asset_manifest_uri !~ '^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'UGC asset manifest URI must use HTTPS and contain no whitespace';
  END IF;

  normalized_hash := lower(NEW.content_hash);
  IF normalized_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'UGC content hash must be a canonical SHA-256 hex digest';
  END IF;

  NEW.content_hash := normalized_hash;

  INSERT INTO ugc_asset_manifest_registry(owner_user_id,manifest_uri,sha256)
  VALUES(NEW.creator_user_id,NEW.asset_manifest_uri,normalized_hash)
  ON CONFLICT(owner_user_id,manifest_uri,sha256)
  DO UPDATE SET updated_at=now()
  RETURNING id INTO registry_id;

  IF EXISTS(
    SELECT 1 FROM ugc_asset_manifest_registry
    WHERE id=registry_id AND status='revoked'
  ) THEN
    RAISE EXCEPTION 'UGC asset manifest declaration is revoked';
  END IF;

  NEW.asset_manifest_registry_id := registry_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ugc_object_blueprints_manifest_integrity_trg ON ugc_object_blueprints;
CREATE TRIGGER ugc_object_blueprints_manifest_integrity_trg
BEFORE INSERT OR UPDATE OF asset_manifest_uri,content_hash
ON ugc_object_blueprints
FOR EACH ROW
EXECUTE FUNCTION bind_ugc_asset_manifest_registry();

-- Backfill only legacy blueprints that already satisfy the new declaration contract.
INSERT INTO ugc_asset_manifest_registry(owner_user_id,manifest_uri,sha256)
SELECT DISTINCT creator_user_id,asset_manifest_uri,lower(content_hash)
FROM ugc_object_blueprints
WHERE asset_manifest_uri ~ '^https://[^[:space:]]+$'
  AND lower(content_hash) ~ '^[0-9a-f]{64}$'
ON CONFLICT(owner_user_id,manifest_uri,sha256) DO NOTHING;

UPDATE ugc_object_blueprints blueprint
SET asset_manifest_registry_id=registry.id,
    content_hash=lower(blueprint.content_hash)
FROM ugc_asset_manifest_registry registry
WHERE blueprint.asset_manifest_registry_id IS NULL
  AND registry.owner_user_id=blueprint.creator_user_id
  AND registry.manifest_uri=blueprint.asset_manifest_uri
  AND registry.sha256=lower(blueprint.content_hash)
  AND registry.status='declared';

COMMIT;

-- Registry records a creator declaration of HTTPS URI + SHA-256 only.
-- It does not claim remote byte retrieval, malware scanning, or external anchoring.
-- Tehkné Solutions
