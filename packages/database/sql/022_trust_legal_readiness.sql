BEGIN;

CREATE TABLE IF NOT EXISTS trust_legal_documents (
  id UUID PRIMARY KEY,
  document_key TEXT NOT NULL,
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'pt-BR',
  audience TEXT NOT NULL DEFAULT 'all'
    CHECK (audience IN ('all', 'minor', 'guardian', 'adult')),
  required_for_beta BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'retired')),
  content_hash TEXT
    CHECK (content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$'),
  public_url TEXT,
  external_review_reference TEXT,
  effective_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_key, version, locale)
);

CREATE INDEX IF NOT EXISTS trust_legal_documents_current_idx
  ON trust_legal_documents(document_key, locale, effective_at DESC)
  WHERE status = 'published';

CREATE TABLE IF NOT EXISTS trust_age_assurance (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  age_band TEXT NOT NULL
    CHECK (age_band IN ('under-14', '14-15', '16-17', '18-plus')),
  assurance_method TEXT NOT NULL
    CHECK (assurance_method IN ('self-declaration', 'guardian-attestation', 'verified-provider')),
  guardian_status TEXT NOT NULL
    CHECK (guardian_status IN ('not-required', 'pending', 'approved', 'rejected')),
  guardian_reviewed_by UUID REFERENCES users(id),
  guardian_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trust_age_assurance_guardian_idx
  ON trust_age_assurance(guardian_status, age_band);

CREATE TABLE IF NOT EXISTS trust_document_acceptances (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES trust_legal_documents(id),
  session_id UUID,
  ip_hash TEXT,
  user_agent_hash TEXT,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawn_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (user_id, document_id)
);

CREATE INDEX IF NOT EXISTS trust_document_acceptances_user_idx
  ON trust_document_acceptances(user_id, accepted_at DESC);

CREATE TABLE IF NOT EXISTS trust_external_reviews (
  id UUID PRIMARY KEY,
  review_type TEXT NOT NULL
    CHECK (review_type IN (
      'independent-security',
      'privacy-lgpd',
      'terms-consumer',
      'asset-classification',
      'minors-safety',
      'incident-response',
      'taxation'
    )),
  reviewer_name TEXT NOT NULL,
  reviewer_organization TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'in-review', 'approved', 'changes-required', 'expired')),
  reference TEXT NOT NULL,
  report_url TEXT,
  summary TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  public_visible BOOLEAN NOT NULL DEFAULT false,
  reviewed_at TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trust_external_reviews_type_idx
  ON trust_external_reviews(review_type, status, valid_until DESC);

CREATE TABLE IF NOT EXISTS trust_incidents (
  id UUID PRIMARY KEY,
  incident_key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL
    CHECK (category IN ('security', 'privacy', 'economy', 'availability', 'abuse', 'legal')),
  severity TEXT NOT NULL
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL
    CHECK (status IN ('open', 'contained', 'resolved', 'postmortem')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  public_visible BOOLEAN NOT NULL DEFAULT false,
  public_notice_url TEXT,
  owner_id UUID REFERENCES users(id),
  detected_at TIMESTAMPTZ NOT NULL,
  contained_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trust_incidents_release_idx
  ON trust_incidents(severity, status)
  WHERE status IN ('open', 'contained');

CREATE TABLE IF NOT EXISTS trust_incident_updates (
  id UUID PRIMARY KEY,
  incident_id UUID NOT NULL REFERENCES trust_incidents(id) ON DELETE CASCADE,
  status TEXT NOT NULL
    CHECK (status IN ('open', 'contained', 'resolved', 'postmortem')),
  note TEXT NOT NULL,
  public_visible BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO trust_legal_documents (
  id, document_key, version, title, locale, audience,
  required_for_beta, status, public_url
)
VALUES
  (
    '15000000-0000-4000-8000-000000000001',
    'terms-of-use', '0.15-draft', 'Termos de Uso',
    'pt-BR', 'all', true, 'draft', '/trust#terms-of-use'
  ),
  (
    '15000000-0000-4000-8000-000000000002',
    'privacy-notice', '0.15-draft', 'Aviso de Privacidade',
    'pt-BR', 'all', true, 'draft', '/trust#privacy-notice'
  ),
  (
    '15000000-0000-4000-8000-000000000003',
    'asset-classification', '0.15-draft', 'Classificação dos Ativos Virtuais',
    'pt-BR', 'all', true, 'draft', '/trust#asset-classification'
  ),
  (
    '15000000-0000-4000-8000-000000000004',
    'child-safety', '0.15-draft', 'Proteção de Adolescentes e Responsáveis',
    'pt-BR', 'minor', true, 'draft', '/trust#child-safety'
  ),
  (
    '15000000-0000-4000-8000-000000000005',
    'consumer-rights', '0.15-draft', 'Compras, Cancelamentos e Direitos do Usuário',
    'pt-BR', 'all', true, 'draft', '/trust#consumer-rights'
  )
ON CONFLICT (document_key, version, locale) DO NOTHING;

INSERT INTO release_gate_checks (gate_key, label, status, evidence, notes)
VALUES
  (
    'legal-documents-published',
    'Documentos legais vigentes e publicados',
    'pending',
    '{}'::jsonb,
    'Publicação depende de revisão jurídica externa e hash do conteúdo.'
  ),
  (
    'independent-security-review',
    'Revisão independente de segurança',
    'pending',
    '{}'::jsonb,
    'Exige relatório externo válido.'
  ),
  (
    'privacy-lgpd-review',
    'Revisão externa de privacidade e LGPD',
    'pending',
    '{}'::jsonb,
    'Exige avaliação independente e plano de correções.'
  ),
  (
    'terms-consumer-review',
    'Termos e defesa do consumidor',
    'pending',
    '{}'::jsonb,
    'Exige revisão jurídica aplicável ao modelo do produto.'
  ),
  (
    'asset-legal-classification',
    'Classificação jurídica dos ativos',
    'pending',
    '{}'::jsonb,
    'NFT, saque e investimento externo permanecem desabilitados.'
  ),
  (
    'minor-safety-review',
    'Proteção de adolescentes e responsáveis',
    'pending',
    '{}'::jsonb,
    'Exige revisão de idade mínima, consentimento e moderação.'
  ),
  (
    'incident-response-approved',
    'Plano de resposta a incidentes aprovado',
    'pending',
    '{}'::jsonb,
    'Exige responsáveis, exercícios e evidências operacionais.'
  )
ON CONFLICT (gate_key) DO NOTHING;

COMMIT;
