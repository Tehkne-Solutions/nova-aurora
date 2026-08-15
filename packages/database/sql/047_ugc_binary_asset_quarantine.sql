BEGIN;

CREATE TABLE IF NOT EXISTS ugc_binary_asset_upload_sessions (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quarantine_object_key text NOT NULL UNIQUE,
  clean_object_key text UNIQUE,
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 180),
  content_type text NOT NULL CHECK (content_type IN (
    'image/png',
    'image/jpeg',
    'image/webp',
    'model/gltf-binary'
  )),
  expected_size_bytes bigint NOT NULL CHECK (expected_size_bytes BETWEEN 1 AND 26214400),
  declared_sha256 text NOT NULL CHECK (declared_sha256 ~ '^[0-9a-f]{64}$'),
  verified_size_bytes bigint CHECK (verified_size_bytes IS NULL OR verified_size_bytes BETWEEN 1 AND 26214400),
  verified_sha256 text CHECK (verified_sha256 IS NULL OR verified_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','scanning','clean','infected','rejected','expired'
  )),
  scanner_engine text,
  scanner_signature text,
  rejection_reason text,
  expires_at timestamptz NOT NULL,
  scanned_at timestamptz,
  promoted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (
    (status='clean'
      AND clean_object_key IS NOT NULL
      AND verified_size_bytes IS NOT NULL
      AND verified_sha256 IS NOT NULL
      AND scanned_at IS NOT NULL
      AND promoted_at IS NOT NULL
      AND scanner_engine IS NOT NULL)
    OR status<>'clean'
  ),
  CHECK (
    (status='infected' AND scanned_at IS NOT NULL AND scanner_engine IS NOT NULL AND scanner_signature IS NOT NULL)
    OR status<>'infected'
  )
);

CREATE INDEX IF NOT EXISTS ugc_binary_asset_upload_owner_idx
  ON ugc_binary_asset_upload_sessions(owner_user_id,status,created_at DESC);

CREATE INDEX IF NOT EXISTS ugc_binary_asset_upload_expiry_idx
  ON ugc_binary_asset_upload_sessions(status,expires_at)
  WHERE status='pending';

CREATE INDEX IF NOT EXISTS ugc_binary_asset_clean_sha_idx
  ON ugc_binary_asset_upload_sessions(verified_sha256)
  WHERE status='clean';

COMMIT;

-- Binary creator assets stay private in quarantine until byte integrity and malware scanning both pass.
-- Tehkné Solutions
