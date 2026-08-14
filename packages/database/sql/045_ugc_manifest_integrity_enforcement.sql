BEGIN;

CREATE OR REPLACE FUNCTION bind_ugc_asset_manifest_registry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  normalized_hash text;
  registry_id uuid;
BEGIN
  IF TG_OP='UPDATE'
     AND NEW.creator_user_id IS NOT DISTINCT FROM OLD.creator_user_id
     AND NEW.asset_manifest_uri IS NOT DISTINCT FROM OLD.asset_manifest_uri
     AND NEW.content_hash IS NOT DISTINCT FROM OLD.content_hash
     AND NEW.asset_manifest_registry_id IS NOT DISTINCT FROM OLD.asset_manifest_registry_id
  THEN
    RETURN NEW;
  END IF;

  IF NEW.asset_manifest_uri !~ '^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'UGC asset manifest URI must use HTTPS and contain no whitespace';
  END IF;

  -- User-info before the first path slash would embed credentials in the URL authority.
  IF NEW.asset_manifest_uri ~ '^https://[^/[:space:]]*@' THEN
    RAISE EXCEPTION 'UGC asset manifest URI must not contain embedded credentials';
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
BEFORE INSERT OR UPDATE OF creator_user_id,asset_manifest_uri,content_hash,asset_manifest_registry_id
ON ugc_object_blueprints
FOR EACH ROW
EXECUTE FUNCTION bind_ugc_asset_manifest_registry();

CREATE OR REPLACE FUNCTION enforce_ugc_blueprint_publication_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  registry_status text;
  registry_owner uuid;
BEGIN
  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;

  IF NEW.asset_manifest_registry_id IS NULL THEN
    RAISE EXCEPTION 'Published UGC blueprint requires an asset manifest integrity declaration';
  END IF;

  SELECT status,owner_user_id
    INTO registry_status,registry_owner
  FROM ugc_asset_manifest_registry
  WHERE id=NEW.asset_manifest_registry_id;

  IF registry_status IS NULL OR registry_status <> 'declared' THEN
    RAISE EXCEPTION 'Published UGC blueprint requires an active asset manifest declaration';
  END IF;

  IF registry_owner IS DISTINCT FROM NEW.creator_user_id THEN
    RAISE EXCEPTION 'UGC asset manifest declaration owner must match blueprint creator';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ugc_object_blueprints_publication_integrity_trg ON ugc_object_blueprints;
CREATE TRIGGER ugc_object_blueprints_publication_integrity_trg
BEFORE INSERT OR UPDATE OF status,asset_manifest_registry_id,creator_user_id
ON ugc_object_blueprints
FOR EACH ROW
EXECUTE FUNCTION enforce_ugc_blueprint_publication_integrity();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='ugc_object_blueprints_published_manifest_registry'
      AND conrelid='ugc_object_blueprints'::regclass
  ) THEN
    ALTER TABLE ugc_object_blueprints
      ADD CONSTRAINT ugc_object_blueprints_published_manifest_registry
      CHECK (status <> 'published' OR asset_manifest_registry_id IS NOT NULL)
      NOT VALID;
  END IF;
END;
$$;

COMMIT;

-- Existing legacy rows remain readable. New inserts and updates are fail-closed.
-- Registry proves creator-declared HTTPS URI + SHA-256 integrity only; it does not claim remote byte verification.
-- Tehkné Solutions
