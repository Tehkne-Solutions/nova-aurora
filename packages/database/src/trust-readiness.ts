import { createHash, randomUUID } from "node:crypto";
import { EconomyRepositoryBase, type Tx } from "./economy-base.js";
import type { AuthenticatedIdentity } from "./auth-security.js";
import {
  REQUIRED_DOCUMENT_KEYS,
  REQUIRED_REVIEW_TYPES,
  evaluateTrustReadiness,
  type RequiredReviewType,
  type TrustReadiness
} from "./trust-readiness-rules.js";
export {
  REQUIRED_DOCUMENT_KEYS,
  REQUIRED_REVIEW_TYPES,
  evaluateTrustReadiness,
  type RequiredDocumentKey,
  type RequiredReviewType,
  type TrustReadiness
} from "./trust-readiness-rules.js";

export type TrustAgeBand = "under-14" | "14-15" | "16-17" | "18-plus";
export type GuardianStatus = "not-required" | "pending" | "approved" | "rejected";
export type TrustDocumentStatus = "draft" | "published" | "retired";
export type ExternalReviewStatus =
  | "pending"
  | "in-review"
  | "approved"
  | "changes-required"
  | "expired";

export type TrustDocumentView = Readonly<{
  id: string;
  key: string;
  version: string;
  title: string;
  locale: string;
  audience: string;
  requiredForBeta: boolean;
  status: TrustDocumentStatus;
  contentHash: string | null;
  publicUrl: string | null;
  externalReviewReference: string | null;
  effectiveAt: string | null;
  publishedAt: string | null;
  acceptedAt?: string | null;
}>;

export type TrustReviewView = Readonly<{
  id: string;
  reviewType: string;
  reviewerName: string;
  reviewerOrganization: string | null;
  status: ExternalReviewStatus;
  reference: string;
  reportUrl: string | null;
  summary: string | null;
  publicVisible: boolean;
  reviewedAt: string | null;
  validUntil: string | null;
}>;

export type TrustIncidentView = Readonly<{
  id: string;
  incidentKey: string;
  category: string;
  severity: string;
  status: string;
  title: string;
  summary: string;
  publicVisible: boolean;
  publicNoticeUrl: string | null;
  detectedAt: string;
  containedAt: string | null;
  resolvedAt: string | null;
}>;

export type TrustUserState = Readonly<{
  enforcementMode: "report-only" | "required";
  ageAssurance: Readonly<{
    ageBand: TrustAgeBand;
    method: string;
    guardianStatus: GuardianStatus;
    recordedAt: string;
    reviewedAt: string | null;
  }> | null;
  documents: readonly TrustDocumentView[];
  documentsComplete: boolean;
  ageReady: boolean;
  mutableAccessReady: boolean;
}>;

function hash(value: string | undefined): string | null {
  return value ? createHash("sha256").update(value).digest("hex") : null;
}

function enforcementMode(): "report-only" | "required" {
  const configured = process.env.TRUST_ENFORCEMENT_MODE;
  if (configured === "required" || configured === "report-only") return configured;
  return process.env.NODE_ENV === "production" ? "required" : "report-only";
}

function iso(value: unknown): string | null {
  return value ? new Date(String(value)).toISOString() : null;
}

export class TrustReadinessService extends EconomyRepositoryBase {
  async readiness(): Promise<TrustReadiness> {
    const [documents, reviews, incidents, guardians] = await Promise.all([
      this.sql`
        SELECT DISTINCT ON (document_key) document_key
        FROM trust_legal_documents
        WHERE required_for_beta=true
          AND status='published'
          AND effective_at<=now()
        ORDER BY document_key,effective_at DESC,updated_at DESC
      `,
      this.sql`
        SELECT DISTINCT ON (review_type) review_type
        FROM trust_external_reviews
        WHERE status='approved'
          AND reviewed_at IS NOT NULL
          AND (valid_until IS NULL OR valid_until>now())
        ORDER BY review_type,reviewed_at DESC,updated_at DESC
      `,
      this.sql`
        SELECT count(*)::int total
        FROM trust_incidents
        WHERE severity='critical' AND status IN ('open','contained')
      `,
      this.sql`
        SELECT count(*)::int total
        FROM trust_age_assurance
        WHERE age_band IN ('14-15','16-17') AND guardian_status='pending'
      `
    ]);

    return evaluateTrustReadiness({
      publishedDocumentKeys: documents.map((row) => String(row.document_key)),
      approvedReviewTypes: reviews.map((row) => String(row.review_type)),
      openCriticalIncidents: Number(incidents[0]?.total ?? 0),
      pendingGuardianReviews: Number(guardians[0]?.total ?? 0)
    });
  }

  async publicState(): Promise<Readonly<{
    readiness: TrustReadiness;
    documents: readonly TrustDocumentView[];
    reviews: readonly TrustReviewView[];
    incidents: readonly TrustIncidentView[];
    notices: Readonly<{
      minimumAge: 14;
      externalTransfersEnabled: false;
      investmentReturnsPromised: false;
      legalConclusionAutomated: false;
    }>;
    signature: "Tehkné Solutions";
  }>> {
    const [readiness, documents, reviews, incidents] = await Promise.all([
      this.readiness(),
      this.sql`
        SELECT * FROM trust_legal_documents
        WHERE status='published' AND effective_at<=now()
        ORDER BY document_key,effective_at DESC
      `,
      this.sql`
        SELECT * FROM trust_external_reviews
        WHERE public_visible=true
        ORDER BY reviewed_at DESC NULLS LAST,created_at DESC
        LIMIT 100
      `,
      this.sql`
        SELECT * FROM trust_incidents
        WHERE public_visible=true
        ORDER BY detected_at DESC
        LIMIT 100
      `
    ]);

    return {
      readiness,
      documents: documents.map((row) => this.documentView(row)),
      reviews: reviews.map((row) => this.reviewView(row)),
      incidents: incidents.map((row) => this.incidentView(row)),
      notices: {
        minimumAge: 14,
        externalTransfersEnabled: false,
        investmentReturnsPromised: false,
        legalConclusionAutomated: false
      },
      signature: "Tehkné Solutions"
    };
  }

  async userState(userId: string): Promise<TrustUserState> {
    const [ageRows, documentRows] = await Promise.all([
      this.sql`
        SELECT age_band,assurance_method,guardian_status,recorded_at,reviewed_at
        FROM trust_age_assurance
        WHERE user_id=${userId}::uuid
      `,
      this.sql`
        SELECT document.*,
          acceptance.accepted_at,
          acceptance.withdrawn_at
        FROM trust_legal_documents document
        LEFT JOIN trust_document_acceptances acceptance
          ON acceptance.document_id=document.id
         AND acceptance.user_id=${userId}::uuid
        WHERE document.required_for_beta=true
          AND document.status='published'
          AND document.effective_at<=now()
        ORDER BY document.document_key,document.effective_at DESC
      `
    ]);

    const age = ageRows[0];
    const ageAssurance = age ? {
      ageBand: String(age.age_band) as TrustAgeBand,
      method: String(age.assurance_method),
      guardianStatus: String(age.guardian_status) as GuardianStatus,
      recordedAt: new Date(String(age.recorded_at)).toISOString(),
      reviewedAt: iso(age.reviewed_at)
    } : null;

    const documents = documentRows.map((row) => ({
      ...this.documentView(row),
      acceptedAt: row.accepted_at && !row.withdrawn_at ? iso(row.accepted_at) : null
    }));
    const currentKeys = new Set(documents.map((document) => document.key));
    const documentsComplete = REQUIRED_DOCUMENT_KEYS.every((key) =>
      currentKeys.has(key)
      && documents.some((document) => document.key === key && Boolean(document.acceptedAt))
    );
    const ageReady = ageAssurance?.ageBand === "18-plus"
      ? ageAssurance.guardianStatus === "not-required"
      : ageAssurance?.ageBand === "14-15" || ageAssurance?.ageBand === "16-17"
        ? ageAssurance.guardianStatus === "approved"
        : false;

    return {
      enforcementMode: enforcementMode(),
      ageAssurance,
      documents,
      documentsComplete,
      ageReady,
      mutableAccessReady: documentsComplete && ageReady
    };
  }

  async assertPlayerReady(userId: string): Promise<void> {
    if (enforcementMode() !== "required") return;
    const state = await this.userState(userId);
    if (!state.ageAssurance) {
      throw new Error("Declare sua faixa etária na Central de Confiança.");
    }
    if (state.ageAssurance.ageBand === "under-14") {
      throw new Error("A Nova Aurora não está disponível para menores de 14 anos.");
    }
    if (!state.ageReady) {
      throw new Error("A autorização do responsável ainda está pendente.");
    }
    if (!state.documentsComplete) {
      throw new Error("Aceite as versões vigentes dos documentos obrigatórios.");
    }
  }

  async setAgeAssurance(input: {
    identity: AuthenticatedIdentity;
    ageBand: TrustAgeBand;
    method: "self-declaration" | "guardian-attestation" | "verified-provider";
    idempotencyKey: string;
  }): Promise<TrustUserState> {
    await this.idempotent(
      `trust-age:${input.idempotencyKey}`,
      input.identity.userId,
      { ageBand: input.ageBand, method: input.method },
      async (tx) => {
        const guardianStatus: GuardianStatus = input.ageBand === "18-plus"
          ? "not-required"
          : input.ageBand === "under-14"
            ? "rejected"
            : "pending";

        await tx`
          INSERT INTO trust_age_assurance (
            user_id,age_band,assurance_method,guardian_status
          ) VALUES (
            ${input.identity.userId}::uuid,${input.ageBand},${input.method},${guardianStatus}
          )
          ON CONFLICT (user_id) DO UPDATE SET
            age_band=excluded.age_band,
            assurance_method=excluded.assurance_method,
            guardian_status=excluded.guardian_status,
            guardian_reviewed_by=NULL,
            guardian_evidence='{}'::jsonb,
            reviewed_at=NULL,
            updated_at=now()
        `;

        if (input.ageBand === "under-14") {
          await tx`
            UPDATE users
            SET public_beta_access='suspended',beta_access_updated_at=now(),updated_at=now()
            WHERE id=${input.identity.userId}::uuid
          `;
        }

        await this.auditTx(tx, {
          identity: input.identity,
          action: "trust.age-assurance.recorded",
          metadata: { ageBand: input.ageBand, method: input.method, guardianStatus }
        });
        await this.outbox(
          tx,
          input.identity.userId,
          "trust.age-assurance.updated",
          { userId: input.identity.userId, ageBand: input.ageBand, guardianStatus }
        );
        return { recorded: true };
      }
    );
    return this.userState(input.identity.userId);
  }

  async acceptDocuments(input: {
    identity: AuthenticatedIdentity;
    documents: readonly Readonly<{ key: string; version: string }>[];
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
    idempotencyKey: string;
  }): Promise<TrustUserState> {
    await this.idempotent(
      `trust-accept:${input.idempotencyKey}`,
      input.identity.userId,
      { documents: input.documents },
      async (tx) => {
        if (input.documents.length === 0 || input.documents.length > 20) {
          throw new Error("Selecione ao menos um documento vigente.");
        }
        const age = await tx`
          SELECT age_band FROM trust_age_assurance
          WHERE user_id=${input.identity.userId}::uuid
          FOR UPDATE
        `;
        if (!age[0]) throw new Error("Declare sua faixa etária antes do aceite.");
        if (String(age[0].age_band) === "under-14") {
          throw new Error("A Nova Aurora não está disponível para menores de 14 anos.");
        }

        for (const document of input.documents) {
          const rows = await tx`
            SELECT id FROM trust_legal_documents
            WHERE document_key=${document.key}
              AND version=${document.version}
              AND status='published'
              AND effective_at<=now()
            FOR UPDATE
          `;
          if (!rows[0]) {
            throw new Error(`Documento vigente não encontrado: ${document.key}.`);
          }
          await tx`
            INSERT INTO trust_document_acceptances (
              id,user_id,document_id,session_id,ip_hash,user_agent_hash,metadata
            ) VALUES (
              ${randomUUID()}::uuid,
              ${input.identity.userId}::uuid,
              ${String(rows[0].id)}::uuid,
              ${input.identity.sessionId}::uuid,
              ${hash(input.ipAddress)},
              ${hash(input.userAgent)},
              ${JSON.stringify({ source: "trust-center" })}::jsonb
            )
            ON CONFLICT (user_id,document_id) DO UPDATE SET
              session_id=excluded.session_id,
              ip_hash=excluded.ip_hash,
              user_agent_hash=excluded.user_agent_hash,
              accepted_at=now(),
              withdrawn_at=NULL,
              metadata=excluded.metadata
          `;
        }

        await this.auditTx(tx, {
          identity: input.identity,
          action: "trust.documents.accepted",
          metadata: { documents: input.documents }
        });
        return { accepted: input.documents.length };
      }
    );
    return this.userState(input.identity.userId);
  }

  async reviewGuardian(input: {
    actorId: string;
    userId: string;
    status: "approved" | "rejected";
    evidence: unknown;
  }): Promise<void> {
    const rows = await this.sql`
      UPDATE trust_age_assurance SET
        guardian_status=${input.status},
        guardian_reviewed_by=${input.actorId}::uuid,
        guardian_evidence=${JSON.stringify(input.evidence)}::jsonb,
        reviewed_at=now(),
        updated_at=now()
      WHERE user_id=${input.userId}::uuid
        AND age_band IN ('14-15','16-17')
      RETURNING user_id
    `;
    if (!rows[0]) throw new Error("Revisão de responsável não encontrada.");
  }

  async upsertDocument(input: {
    actorId: string;
    key: string;
    version: string;
    title: string;
    locale: string;
    audience: "all" | "minor" | "guardian" | "adult";
    requiredForBeta: boolean;
    status: TrustDocumentStatus;
    contentHash?: string | undefined;
    publicUrl?: string | undefined;
    externalReviewReference?: string | undefined;
    effectiveAt?: string | undefined;
    idempotencyKey: string;
  }): Promise<TrustDocumentView> {
    if (input.status === "published") {
      if (!input.contentHash || !/^[a-f0-9]{64}$/.test(input.contentHash)) {
        throw new Error("Hash SHA-256 obrigatório para publicação.");
      }
      if (!input.publicUrl || !input.externalReviewReference || !input.effectiveAt) {
        throw new Error("URL, revisão externa e vigência são obrigatórias.");
      }
    }

    return this.idempotent(
      `trust-document:${input.idempotencyKey}`,
      input.actorId,
      input,
      async (tx) => {
        if (input.status === "published") {
          await tx`
            UPDATE trust_legal_documents SET
              status='retired',updated_by=${input.actorId}::uuid,updated_at=now()
            WHERE document_key=${input.key}
              AND locale=${input.locale}
              AND status='published'
              AND version<>${input.version}
          `;
        }
        const rows = await tx`
          INSERT INTO trust_legal_documents (
            id,document_key,version,title,locale,audience,required_for_beta,
            status,content_hash,public_url,external_review_reference,effective_at,
            published_at,created_by,updated_by
          ) VALUES (
            ${randomUUID()}::uuid,${input.key},${input.version},${input.title},
            ${input.locale},${input.audience},${input.requiredForBeta},
            ${input.status},${input.contentHash ?? null},${input.publicUrl ?? null},
            ${input.externalReviewReference ?? null},${input.effectiveAt ?? null},
            ${input.status === "published" ? new Date().toISOString() : null},
            ${input.actorId}::uuid,${input.actorId}::uuid
          )
          ON CONFLICT (document_key,version,locale) DO UPDATE SET
            title=excluded.title,audience=excluded.audience,
            required_for_beta=excluded.required_for_beta,status=excluded.status,
            content_hash=excluded.content_hash,public_url=excluded.public_url,
            external_review_reference=excluded.external_review_reference,
            effective_at=excluded.effective_at,
            published_at=CASE
              WHEN excluded.status='published'
              THEN COALESCE(trust_legal_documents.published_at,now())
              ELSE trust_legal_documents.published_at
            END,
            updated_by=excluded.updated_by,updated_at=now()
          RETURNING *
        `;
        const row = rows[0];
        if (!row) throw new Error("Documento não pôde ser salvo.");
        await this.outbox(
          tx,
          String(row.id),
          "trust.document.updated",
          { key: input.key, version: input.version, status: input.status }
        );
        return this.documentView(row);
      }
    );
  }

  async recordExternalReview(input: {
    actorId: string;
    reviewType: RequiredReviewType;
    reviewerName: string;
    reviewerOrganization?: string | undefined;
    status: ExternalReviewStatus;
    reference: string;
    reportUrl?: string | undefined;
    summary?: string | undefined;
    evidence?: unknown;
    publicVisible: boolean;
    reviewedAt?: string | undefined;
    validUntil?: string | undefined;
    idempotencyKey: string;
  }): Promise<TrustReviewView> {
    if (input.status === "approved" && !input.reportUrl) {
      throw new Error("Relatório externo obrigatório para aprovação.");
    }
    return this.idempotent(
      `trust-review:${input.idempotencyKey}`,
      input.actorId,
      input,
      async (tx) => {
        const rows = await tx`
          INSERT INTO trust_external_reviews (
            id,review_type,reviewer_name,reviewer_organization,status,reference,
            report_url,summary,evidence,public_visible,reviewed_at,valid_until,created_by
          ) VALUES (
            ${randomUUID()}::uuid,${input.reviewType},${input.reviewerName},
            ${input.reviewerOrganization ?? null},${input.status},${input.reference},
            ${input.reportUrl ?? null},${input.summary ?? null},
            ${JSON.stringify(input.evidence ?? {})}::jsonb,${input.publicVisible},
            ${input.reviewedAt ?? null},${input.validUntil ?? null},${input.actorId}::uuid
          )
          RETURNING *
        `;
        const row = rows[0];
        if (!row) throw new Error("Revisão externa não pôde ser registrada.");
        return this.reviewView(row);
      }
    );
  }

  async createIncident(input: {
    actorId: string;
    category: "security" | "privacy" | "economy" | "availability" | "abuse" | "legal";
    severity: "low" | "medium" | "high" | "critical";
    title: string;
    summary: string;
    publicVisible: boolean;
    publicNoticeUrl?: string | undefined;
    detectedAt: string;
    idempotencyKey: string;
  }): Promise<TrustIncidentView> {
    return this.idempotent(
      `trust-incident:${input.idempotencyKey}`,
      input.actorId,
      input,
      async (tx) => {
        const id = randomUUID();
        const incidentKey = `INC-${new Date(input.detectedAt).getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}`;
        const rows = await tx`
          INSERT INTO trust_incidents (
            id,incident_key,category,severity,status,title,summary,public_visible,
            public_notice_url,owner_id,detected_at,created_by
          ) VALUES (
            ${id}::uuid,${incidentKey},${input.category},${input.severity},'open',
            ${input.title},${input.summary},${input.publicVisible},
            ${input.publicNoticeUrl ?? null},${input.actorId}::uuid,
            ${input.detectedAt},${input.actorId}::uuid
          )
          RETURNING *
        `;
        const row = rows[0];
        if (!row) throw new Error("Incidente não pôde ser criado.");
        await this.outbox(
          tx,
          id,
          "trust.incident.created",
          { incidentKey, category: input.category, severity: input.severity }
        );
        return this.incidentView(row);
      }
    );
  }

  async updateIncident(input: {
    actorId: string;
    incidentId: string;
    status: "open" | "contained" | "resolved" | "postmortem";
    note: string;
    publicVisible: boolean;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      const rows = await tx`
        UPDATE trust_incidents SET
          status=${input.status},
          contained_at=CASE
            WHEN ${input.status}='contained' THEN COALESCE(contained_at,now())
            ELSE contained_at
          END,
          resolved_at=CASE
            WHEN ${input.status} IN ('resolved','postmortem') THEN COALESCE(resolved_at,now())
            ELSE resolved_at
          END,
          updated_at=now()
        WHERE id=${input.incidentId}::uuid
        RETURNING id
      `;
      if (!rows[0]) throw new Error("Incidente não encontrado.");
      await tx`
        INSERT INTO trust_incident_updates (
          id,incident_id,status,note,public_visible,created_by
        ) VALUES (
          ${randomUUID()}::uuid,${input.incidentId}::uuid,${input.status},
          ${input.note},${input.publicVisible},${input.actorId}::uuid
        )
      `;
      await this.outbox(
        tx,
        input.incidentId,
        "trust.incident.updated",
        { status: input.status, publicVisible: input.publicVisible }
      );
    });
  }

  async adminState(): Promise<Readonly<{
    readiness: TrustReadiness;
    documents: readonly TrustDocumentView[];
    reviews: readonly TrustReviewView[];
    incidents: readonly TrustIncidentView[];
    pendingGuardians: readonly Readonly<{
      userId: string;
      email: string;
      displayName: string;
      ageBand: TrustAgeBand;
      recordedAt: string;
    }>[];
  }>> {
    const [readiness, documents, reviews, incidents, guardians] = await Promise.all([
      this.readiness(),
      this.sql`SELECT * FROM trust_legal_documents ORDER BY document_key,created_at DESC`,
      this.sql`SELECT * FROM trust_external_reviews ORDER BY created_at DESC`,
      this.sql`SELECT * FROM trust_incidents ORDER BY detected_at DESC`,
      this.sql`
        SELECT assurance.user_id,user_account.email,user_account.display_name,
          assurance.age_band,assurance.recorded_at
        FROM trust_age_assurance assurance
        JOIN users user_account ON user_account.id=assurance.user_id
        WHERE assurance.age_band IN ('14-15','16-17')
          AND assurance.guardian_status='pending'
        ORDER BY assurance.recorded_at
      `
    ]);

    return {
      readiness,
      documents: documents.map((row) => this.documentView(row)),
      reviews: reviews.map((row) => this.reviewView(row)),
      incidents: incidents.map((row) => this.incidentView(row)),
      pendingGuardians: guardians.map((row) => ({
        userId: String(row.user_id),
        email: String(row.email),
        displayName: String(row.display_name),
        ageBand: String(row.age_band) as TrustAgeBand,
        recordedAt: new Date(String(row.recorded_at)).toISOString()
      }))
    };
  }

  private documentView(row: Record<string, unknown>): TrustDocumentView {
    return {
      id: String(row.id),
      key: String(row.document_key),
      version: String(row.version),
      title: String(row.title),
      locale: String(row.locale),
      audience: String(row.audience),
      requiredForBeta: Boolean(row.required_for_beta),
      status: String(row.status) as TrustDocumentStatus,
      contentHash: row.content_hash ? String(row.content_hash) : null,
      publicUrl: row.public_url ? String(row.public_url) : null,
      externalReviewReference: row.external_review_reference
        ? String(row.external_review_reference)
        : null,
      effectiveAt: iso(row.effective_at),
      publishedAt: iso(row.published_at)
    };
  }

  private reviewView(row: Record<string, unknown>): TrustReviewView {
    return {
      id: String(row.id),
      reviewType: String(row.review_type),
      reviewerName: String(row.reviewer_name),
      reviewerOrganization: row.reviewer_organization
        ? String(row.reviewer_organization)
        : null,
      status: String(row.status) as ExternalReviewStatus,
      reference: String(row.reference),
      reportUrl: row.report_url ? String(row.report_url) : null,
      summary: row.summary ? String(row.summary) : null,
      publicVisible: Boolean(row.public_visible),
      reviewedAt: iso(row.reviewed_at),
      validUntil: iso(row.valid_until)
    };
  }

  private incidentView(row: Record<string, unknown>): TrustIncidentView {
    return {
      id: String(row.id),
      incidentKey: String(row.incident_key),
      category: String(row.category),
      severity: String(row.severity),
      status: String(row.status),
      title: String(row.title),
      summary: String(row.summary),
      publicVisible: Boolean(row.public_visible),
      publicNoticeUrl: row.public_notice_url ? String(row.public_notice_url) : null,
      detectedAt: new Date(String(row.detected_at)).toISOString(),
      containedAt: iso(row.contained_at),
      resolvedAt: iso(row.resolved_at)
    };
  }

  private async auditTx(tx: Tx, input: {
    identity: AuthenticatedIdentity;
    action: string;
    metadata: unknown;
  }): Promise<void> {
    await tx`
      INSERT INTO security_audit_log (
        actor_user_id,subject_user_id,session_id,action,outcome,risk_level,metadata
      ) VALUES (
        ${input.identity.userId}::uuid,${input.identity.userId}::uuid,
        ${input.identity.sessionId}::uuid,${input.action},'success','medium',
        ${JSON.stringify(input.metadata)}::jsonb
      )
    `;
  }
}
