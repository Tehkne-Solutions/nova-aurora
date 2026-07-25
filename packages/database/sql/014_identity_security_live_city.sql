BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending','active','suspended','disabled')),
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS password_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN (
    'citizen','company-owner','employee','council-member','municipal-admin','platform-admin'
  )),
  granted_by uuid REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  PRIMARY KEY (user_id,role)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','rotated','revoked','expired')),
  ip_hash text,
  user_agent_hash text,
  device_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_by_session_id uuid REFERENCES auth_sessions(id),
  CHECK (expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS security_audit_log (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id),
  subject_user_id uuid REFERENCES users(id),
  session_id uuid REFERENCES auth_sessions(id),
  action text NOT NULL,
  resource_type text,
  resource_id text,
  outcome text NOT NULL CHECK (outcome IN ('success','denied','failure')),
  risk_level text NOT NULL DEFAULT 'low'
    CHECK (risk_level IN ('low','medium','high','critical')),
  ip_hash text,
  user_agent_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rate_limit_windows (
  scope_key text NOT NULL,
  action text NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key,action,window_started_at)
);

CREATE TABLE IF NOT EXISTS live_presence (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES auth_sessions(id) ON DELETE SET NULL,
  location_code text,
  status text NOT NULL DEFAULT 'online'
    CHECK (status IN ('online','away','busy','offline')),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  connected_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS user_notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  severity text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info','success','warning','critical')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_active_idx
  ON auth_sessions(user_id,last_seen_at DESC)
  WHERE status='active';
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx
  ON auth_sessions(expires_at) WHERE status='active';
CREATE INDEX IF NOT EXISTS audit_actor_time_idx
  ON security_audit_log(actor_user_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_action_time_idx
  ON security_audit_log(action,occurred_at DESC);
CREATE INDEX IF NOT EXISTS rate_limit_cleanup_idx
  ON rate_limit_windows(window_started_at,blocked_until);
CREATE INDEX IF NOT EXISTS live_presence_heartbeat_idx
  ON live_presence(last_heartbeat_at DESC);
CREATE INDEX IF NOT EXISTS notification_unread_idx
  ON user_notifications(user_id,created_at DESC) WHERE read_at IS NULL;

UPDATE users SET
  password_hash=crypt(
    CASE email
      WHEN 'alice@nova-aurora.local' THEN 'Aurora@2026'
      WHEN 'bob@nova-aurora.local' THEN 'Horizonte@2026'
      ELSE 'NovaAurora@2026'
    END,
    gen_salt('bf',12)
  ),
  email_verified_at=COALESCE(email_verified_at,now()),
  password_updated_at=COALESCE(password_updated_at,now()),
  updated_at=now()
WHERE password_hash IS NULL;

ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;

INSERT INTO user_roles (user_id,role,granted_by) VALUES
  ('11111111-1111-4111-8111-111111111111','citizen','11111111-1111-4111-8111-111111111111'),
  ('11111111-1111-4111-8111-111111111111','company-owner','11111111-1111-4111-8111-111111111111'),
  ('11111111-1111-4111-8111-111111111111','municipal-admin','11111111-1111-4111-8111-111111111111'),
  ('11111111-1111-4111-8111-111111111111','platform-admin','11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222','citizen','11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222','company-owner','11111111-1111-4111-8111-111111111111')
ON CONFLICT (user_id,role) DO NOTHING;

INSERT INTO user_notifications (id,user_id,event_type,title,body,severity,payload) VALUES
  ('e1000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
   'security.identity-enabled','Identidade protegida',
   'Sessões persistentes, papéis e auditoria foram ativados para sua conta.','success',
   '{"signature":"Tehkné Solutions"}'::jsonb),
  ('e1000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222',
   'security.identity-enabled','Identidade protegida',
   'Sessões persistentes, papéis e auditoria foram ativados para sua conta.','success',
   '{"signature":"Tehkné Solutions"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

COMMIT;
