BEGIN;

ALTER TABLE trust_age_assurance
  ADD COLUMN IF NOT EXISTS previous_beta_access text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='trust_age_previous_beta_access_check'
  ) THEN
    ALTER TABLE trust_age_assurance ADD CONSTRAINT trust_age_previous_beta_access_check
      CHECK (previous_beta_access IS NULL OR previous_beta_access IN ('pending','invited','active','suspended'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS trust_guardian_requests (
  id uuid PRIMARY KEY,
  minor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guardian_email_hash text NOT NULL,
  relationship text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','expired','revoked')),
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  response_ip_hash text,
  response_user_agent_hash text,
  decision_statement text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS trust_guardian_requests_pending_user_idx
  ON trust_guardian_requests(minor_user_id)
  WHERE status='pending';
CREATE INDEX IF NOT EXISTS trust_guardian_requests_expiry_idx
  ON trust_guardian_requests(expires_at)
  WHERE status='pending';

CREATE TABLE IF NOT EXISTS trust_reports (
  id uuid PRIMARY KEY,
  report_key text NOT NULL UNIQUE,
  submission_key text NOT NULL UNIQUE,
  payload_hash text NOT NULL,
  reporter_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  category text NOT NULL
    CHECK (category IN ('abuse','harassment','fraud','minor-safety','privacy','security','content','other')),
  subject_type text NOT NULL
    CHECK (subject_type IN ('user','company','listing','message','event','system','other')),
  subject_reference text,
  summary text NOT NULL,
  details bytea NOT NULL,
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','critical')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','triaged','investigating','actioned','closed','dismissed')),
  assigned_to uuid REFERENCES users(id),
  public_reference_allowed boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE INDEX IF NOT EXISTS trust_reports_queue_idx
  ON trust_reports(priority,status,created_at)
  WHERE status IN ('open','triaged','investigating');

CREATE TABLE IF NOT EXISTS trust_report_updates (
  id uuid PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES trust_reports(id) ON DELETE CASCADE,
  status text NOT NULL
    CHECK (status IN ('open','triaged','investigating','actioned','closed','dismissed')),
  note text NOT NULL,
  action_code text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trust_response_exercises (
  id uuid PRIMARY KEY,
  exercise_key text NOT NULL UNIQUE,
  scenario text NOT NULL,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','running','passed','failed','cancelled')),
  scheduled_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  objectives jsonb NOT NULL DEFAULT '[]'::jsonb,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  owner_id uuid NOT NULL REFERENCES users(id),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trust_response_exercises_current_idx
  ON trust_response_exercises(completed_at DESC)
  WHERE status='passed';

CREATE TABLE IF NOT EXISTS trust_exercise_actions (
  id uuid PRIMARY KEY,
  exercise_id uuid NOT NULL REFERENCES trust_response_exercises(id) ON DELETE CASCADE,
  title text NOT NULL,
  owner_id uuid REFERENCES users(id),
  due_at timestamptz,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in-progress','completed','cancelled')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_service_components (
  component_key text PRIMARY KEY,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'maintenance'
    CHECK (status IN ('operational','degraded','partial-outage','major-outage','maintenance')),
  description text,
  public_message text,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_service_component_updates (
  id uuid PRIMARY KEY,
  component_key text NOT NULL REFERENCES public_service_components(component_key),
  previous_status text,
  status text NOT NULL,
  message text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public_service_components (component_key,label,status,description) VALUES
  ('web','Aplicação web','maintenance','Interface pública e experiência do usuário.'),
  ('api','API principal','maintenance','Comandos, consultas e autenticação.'),
  ('market','Mercado e produção','maintenance','Ordens, negociações, inventário e produção.'),
  ('transactional-email','E-mail transacional','maintenance','Verificação, recuperação e comunicações operacionais.'),
  ('database','Persistência econômica','maintenance','PostgreSQL, ledger e estado do mundo.')
ON CONFLICT (component_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS launch_rehearsals (
  id uuid PRIMARY KEY,
  rehearsal_key text NOT NULL UNIQUE,
  rehearsal_type text NOT NULL
    CHECK (rehearsal_type IN ('public-beta-open','rollback','provider-delivery','backup-restore')),
  environment text NOT NULL,
  commit_sha text,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','running','passed','failed','cancelled')),
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  started_at timestamptz,
  completed_at timestamptz,
  owner_id uuid NOT NULL REFERENCES users(id),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS launch_rehearsals_type_current_idx
  ON launch_rehearsals(rehearsal_type,completed_at DESC)
  WHERE status='passed';

INSERT INTO release_gate_checks (gate_key,label,status,evidence,notes) VALUES
  ('guardian-consent-flow','Consentimento verificável de responsável','passing',
    '{"implementedIn":"sprint-16","method":"email-possession-token"}'::jsonb,
    'Fluxo técnico implementado; revisão jurídica continua necessária.'),
  ('moderation-channel','Canal de denúncias e moderação','passing',
    '{"implementedIn":"sprint-16","anonymous":true}'::jsonb,
    'Canal público e fila administrativa implementados.'),
  ('public-status-page','Página pública de status','passing',
    '{"implementedIn":"sprint-16","components":5}'::jsonb,
    'Componentes e eventos públicos disponíveis.'),
  ('incident-exercise-current','Exercício de incidente vigente','pending','{}'::jsonb,
    'Exige exercício aprovado nos últimos 180 dias.'),
  ('launch-rehearsal-current','Ensaio de abertura vigente','pending','{}'::jsonb,
    'Exige ensaio aprovado nos últimos 30 dias.'),
  ('rollback-rehearsal-current','Ensaio de rollback vigente','pending','{}'::jsonb,
    'Exige ensaio aprovado nos últimos 30 dias.')
ON CONFLICT (gate_key) DO NOTHING;

COMMIT;
