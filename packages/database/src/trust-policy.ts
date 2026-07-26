import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AuthenticatedIdentity } from "./auth-security.js";
import { enqueueTransactionalEmail } from "./transactional-email.js";
import {
  REQUIRED_DOCUMENT_KEYS,
  TrustReadinessService,
  type ExternalReviewStatus,
  type GuardianStatus,
  type TrustAgeBand,
  type TrustDocumentStatus,
  type TrustDocumentView,
  type TrustIncidentView,
  type TrustReviewView,
  type TrustUserState
} from "./trust-readiness.js";

export type GuardianRequestView = Readonly<{
  id: string;
  status: string;
  relationship: string;
  expiresAt: string;
  respondedAt: string | null;
  createdAt: string;
}>;

export type TrustPolicyUserState = TrustUserState & Readonly<{
  guardianRequests: readonly GuardianRequestView[];
}>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function iso(value: unknown): string | null {
  return value ? new Date(String(value)).toISOString() : null;
}

function publicWebUrl(): string {
  const configured = process.env.PUBLIC_WEB_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") {
    throw new Error("PUBLIC_WEB_URL não configurada.");
  }
  return "http://localhost:3000";
}

function enforcementMode(): "report-only" | "required" {
  const configured = process.env.TRUST_ENFORCEMENT_MODE;
  if (configured === "report-only" || configured === "required") return configured;
  return process.env.NODE_ENV === "production" ? "required" : "report-only";
}

export class TrustPolicyService extends TrustReadinessService {
  override async publicState(): Promise<Readonly<{
    readiness: Awaited<ReturnType<TrustReadinessService["readiness"]>>;
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
        SELECT DISTINCT ON (document_key) * FROM trust_legal_documents
        WHERE status='published' AND effective_at<=now()
        ORDER BY document_key,effective_at DESC,updated_at DESC
      `,
      this.sql`
        SELECT * FROM trust_external_reviews WHERE public_visible=true
        ORDER BY reviewed_at DESC NULLS LAST,created_at DESC LIMIT 100
      `,
      this.sql`
        SELECT * FROM trust_incidents WHERE public_visible=true
        ORDER BY detected_at DESC LIMIT 100
      `
    ]);
    return {
      readiness,
      documents: documents.map((row) => this.mapDocument(row)),
      reviews: reviews.map((row) => this.mapReview(row)),
      incidents: incidents.map((row) => this.mapIncident(row)),
      notices: {
        minimumAge: 14,
        externalTransfersEnabled: false,
        investmentReturnsPromised: false,
        legalConclusionAutomated: false
      },
      signature: "Tehkné Solutions"
    };
  }

  override async userState(userId: string): Promise<TrustPolicyUserState> {
    const [ageRows, documents, guardianRequests] = await Promise.all([
      this.sql`
        SELECT age_band,assurance_method,guardian_status,recorded_at,reviewed_at
        FROM trust_age_assurance WHERE user_id=${userId}::uuid
      `,
      this.sql`
        WITH current_documents AS (
          SELECT DISTINCT ON (document_key) * FROM trust_legal_documents
          WHERE required_for_beta=true AND status='published' AND effective_at<=now()
          ORDER BY document_key,effective_at DESC,updated_at DESC
        )
        SELECT document.*,acceptance.accepted_at,acceptance.withdrawn_at
        FROM current_documents document
        LEFT JOIN trust_document_acceptances acceptance
          ON acceptance.document_id=document.id AND acceptance.user_id=${userId}::uuid
        ORDER BY document.document_key
      `,
      this.sql`
        SELECT id,status,relationship,expires_at,responded_at,created_at
        FROM trust_guardian_requests WHERE minor_user_id=${userId}::uuid
        ORDER BY created_at DESC LIMIT 20
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
    const mappedDocuments = documents.map((row) => ({
      ...this.mapDocument(row),
      acceptedAt: row.accepted_at && !row.withdrawn_at ? iso(row.accepted_at) : null
    }));
    const documentsComplete = REQUIRED_DOCUMENT_KEYS.every((key) =>
      mappedDocuments.some((document) => document.key === key && Boolean(document.acceptedAt))
    );
    const ageReady = ageAssurance?.ageBand === "18-plus"
      ? ageAssurance.guardianStatus === "not-required"
      : ageAssurance?.ageBand === "14-15" || ageAssurance?.ageBand === "16-17"
        ? ageAssurance.guardianStatus === "approved"
        : false;
    return {
      enforcementMode: enforcementMode(),
      ageAssurance,
      documents: mappedDocuments,
      documentsComplete,
      ageReady,
      mutableAccessReady: documentsComplete && ageReady,
      guardianRequests: guardianRequests.map((row) => this.mapGuardianRequest(row))
    };
  }

  override async setAgeAssurance(input: {
    identity: AuthenticatedIdentity;
    ageBand: TrustAgeBand;
    method: "self-declaration" | "guardian-attestation" | "verified-provider";
    idempotencyKey: string;
  }): Promise<TrustPolicyUserState> {
    await this.idempotent(
      `trust-age-v2:${input.idempotencyKey}`,
      input.identity.userId,
      { ageBand: input.ageBand, method: input.method },
      async (tx) => {
        const [users, oldAssurance] = await Promise.all([
          tx`
            SELECT public_beta_access,email_verified_at,status FROM users
            WHERE id=${input.identity.userId}::uuid FOR UPDATE
          `,
          tx`
            SELECT age_band,previous_beta_access FROM trust_age_assurance
            WHERE user_id=${input.identity.userId}::uuid FOR UPDATE
          `
        ]);
        const user = users[0];
        if (!user) throw new Error("Conta não encontrada.");
        const old = oldAssurance[0];
        const guardianStatus: GuardianStatus = input.ageBand === "18-plus"
          ? "not-required"
          : input.ageBand === "under-14" ? "rejected" : "pending";
        const previousAccess = input.ageBand === "under-14"
          ? String(old?.previous_beta_access ?? user.public_beta_access)
          : old?.previous_beta_access ? String(old.previous_beta_access) : null;
        await tx`
          INSERT INTO trust_age_assurance (
            user_id,age_band,assurance_method,guardian_status,previous_beta_access
          ) VALUES (
            ${input.identity.userId}::uuid,${input.ageBand},${input.method},
            ${guardianStatus},${previousAccess}
          )
          ON CONFLICT (user_id) DO UPDATE SET
            age_band=excluded.age_band,
            assurance_method=excluded.assurance_method,
            guardian_status=excluded.guardian_status,
            previous_beta_access=excluded.previous_beta_access,
            guardian_reviewed_by=NULL,
            guardian_evidence='{}'::jsonb,
            reviewed_at=NULL,
            updated_at=now()
        `;
        if (input.ageBand === "under-14") {
          await tx`
            UPDATE users SET public_beta_access='suspended',beta_access_updated_at=now(),updated_at=now()
            WHERE id=${input.identity.userId}::uuid
          `;
        } else if (String(old?.age_band ?? "") === "under-14"
          && String(user.public_beta_access) === "suspended") {
          const restored = previousAccess && previousAccess !== "suspended"
            ? previousAccess
            : user.email_verified_at && String(user.status) === "active" ? "active" : "pending";
          await tx`
            UPDATE users SET public_beta_access=${restored},beta_access_updated_at=now(),updated_at=now()
            WHERE id=${input.identity.userId}::uuid
          `;
        }
        await this.outbox(tx, input.identity.userId, "trust.age-assurance.updated", {
          userId: input.identity.userId,
          ageBand: input.ageBand,
          guardianStatus
        });
        return { recorded: true };
      }
    );
    return this.userState(input.identity.userId);
  }

  override async upsertDocument(input: {
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
      `trust-document-v2:${input.idempotencyKey}`,
      input.actorId,
      input,
      async (tx) => {
        const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : null;
        if (input.status === "published" && effectiveAt && effectiveAt.getTime() <= Date.now()) {
          await tx`
            UPDATE trust_legal_documents SET status='retired',updated_by=${input.actorId}::uuid,updated_at=now()
            WHERE document_key=${input.key} AND locale=${input.locale}
              AND status='published' AND effective_at<=now() AND version<>${input.version}
          `;
        }
        const rows = await tx`
          INSERT INTO trust_legal_documents (
            id,document_key,version,title,locale,audience,required_for_beta,status,
            content_hash,public_url,external_review_reference,effective_at,published_at,
            created_by,updated_by
          ) VALUES (
            ${randomUUID()}::uuid,${input.key},${input.version},${input.title},${input.locale},
            ${input.audience},${input.requiredForBeta},${input.status},${input.contentHash ?? null},
            ${input.publicUrl ?? null},${input.externalReviewReference ?? null},
            ${input.effectiveAt ?? null},${input.status === "published" ? new Date().toISOString() : null},
            ${input.actorId}::uuid,${input.actorId}::uuid
          )
          ON CONFLICT (document_key,version,locale) DO UPDATE SET
            title=excluded.title,audience=excluded.audience,
            required_for_beta=excluded.required_for_beta,status=excluded.status,
            content_hash=excluded.content_hash,public_url=excluded.public_url,
            external_review_reference=excluded.external_review_reference,
            effective_at=excluded.effective_at,
            published_at=CASE WHEN excluded.status='published'
              THEN COALESCE(trust_legal_documents.published_at,now())
              ELSE trust_legal_documents.published_at END,
            updated_by=excluded.updated_by,updated_at=now()
          RETURNING *
        `;
        const row = rows[0];
        if (!row) throw new Error("Documento não pôde ser salvo.");
        await this.outbox(tx, String(row.id), "trust.document.updated", {
          key: input.key, version: input.version, status: input.status,
          effectiveAt: input.effectiveAt ?? null
        });
        return this.mapDocument(row);
      }
    );
  }

  async requestGuardianConsent(input: {
    identity: AuthenticatedIdentity;
    guardianEmail: string;
    relationship: string;
    idempotencyKey: string;
  }): Promise<Readonly<{ request: GuardianRequestView; deliveryAccepted: true }>> {
    const guardianEmail = normalizeEmail(input.guardianEmail);
    const token = randomBytes(32).toString("base64url");
    const requestId = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    const request = await this.idempotent(
      `guardian-request:${input.idempotencyKey}`,
      input.identity.userId,
      { guardianEmailHash: sha256(guardianEmail), relationship: input.relationship },
      async (tx) => {
        const rows = await tx`
          SELECT assurance.age_band,user_account.email
          FROM trust_age_assurance assurance
          JOIN users user_account ON user_account.id=assurance.user_id
          WHERE assurance.user_id=${input.identity.userId}::uuid FOR UPDATE
        `;
        const assurance = rows[0];
        if (!assurance || !["14-15", "16-17"].includes(String(assurance.age_band))) {
          throw new Error("Solicitação disponível apenas para usuários de 14 a 17 anos.");
        }
        if (guardianEmail === normalizeEmail(String(assurance.email))) {
          throw new Error("O e-mail do responsável deve ser diferente do e-mail da conta.");
        }
        await tx`
          UPDATE trust_guardian_requests SET status='revoked',updated_at=now()
          WHERE minor_user_id=${input.identity.userId}::uuid AND status='pending'
        `;
        const inserted = await tx`
          INSERT INTO trust_guardian_requests (
            id,minor_user_id,guardian_email_hash,relationship,token_hash,status,expires_at
          ) VALUES (
            ${requestId}::uuid,${input.identity.userId}::uuid,${sha256(guardianEmail)},
            ${input.relationship},${sha256(token)},'pending',${expiresAt.toISOString()}
          ) RETURNING *
        `;
        await enqueueTransactionalEmail(tx, {
          deliveryKey: `guardian-consent:${requestId}`,
          userId: input.identity.userId,
          recipient: guardianEmail,
          template: "security-alert",
          subject: "Autorize a participação na Nova Aurora",
          payload: {
            guardianUrl: `${publicWebUrl()}/guardian?token=${encodeURIComponent(token)}`,
            minorDisplayName: input.identity.displayName,
            relationship: input.relationship,
            expiresAt: expiresAt.toISOString(),
            statement: "A autorização não ativa saques, investimentos ou transferências externas.",
            signature: "Tehkné Solutions"
          }
        });
        return this.mapGuardianRequest(inserted[0]);
      }
    );
    return { request, deliveryAccepted: true };
  }

  async guardianDecision(input: {
    token: string;
    decision: "approved" | "rejected";
    guardianName: string;
    statementAccepted: boolean;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<Readonly<{ decided: true; status: "approved" | "rejected" }>> {
    if (!input.statementAccepted) {
      throw new Error("A declaração de responsabilidade precisa ser confirmada.");
    }
    await this.sql.begin("isolation level serializable", async (tx) => {
      const rows = await tx`
        SELECT * FROM trust_guardian_requests
        WHERE token_hash=${sha256(input.token)} AND status='pending'
          AND expires_at>now() FOR UPDATE
      `;
      const request = rows[0];
      if (!request) throw new Error("Solicitação inválida, expirada ou já utilizada.");
      await tx`
        UPDATE trust_guardian_requests SET
          status=${input.decision},responded_at=now(),
          response_ip_hash=${input.ipAddress ? sha256(input.ipAddress) : null},
          response_user_agent_hash=${input.userAgent ? sha256(input.userAgent) : null},
          decision_statement='Declaração de responsabilidade confirmada.',updated_at=now()
        WHERE id=${String(request.id)}::uuid
      `;
      await tx`
        UPDATE trust_age_assurance SET guardian_status=${input.decision},
          guardian_evidence=${JSON.stringify({
            method: "email-possession-token",
            requestId: String(request.id),
            guardianNameHash: sha256(input.guardianName.trim().toLowerCase())
          })}::jsonb,
          reviewed_at=now(),updated_at=now()
        WHERE user_id=${String(request.minor_user_id)}::uuid
      `;
      await this.outbox(tx, String(request.minor_user_id), "trust.guardian.decision-recorded", {
        requestId: String(request.id), status: input.decision
      });
    });
    return { decided: true, status: input.decision };
  }

  private mapDocument(row: Record<string, unknown>): TrustDocumentView {
    return {
      id: String(row.id), key: String(row.document_key), version: String(row.version),
      title: String(row.title), locale: String(row.locale), audience: String(row.audience),
      requiredForBeta: Boolean(row.required_for_beta),
      status: String(row.status) as TrustDocumentStatus,
      contentHash: row.content_hash ? String(row.content_hash) : null,
      publicUrl: row.public_url ? String(row.public_url) : null,
      externalReviewReference: row.external_review_reference
        ? String(row.external_review_reference) : null,
      effectiveAt: iso(row.effective_at), publishedAt: iso(row.published_at)
    };
  }

  private mapReview(row: Record<string, unknown>): TrustReviewView {
    return {
      id: String(row.id), reviewType: String(row.review_type),
      reviewerName: String(row.reviewer_name),
      reviewerOrganization: row.reviewer_organization ? String(row.reviewer_organization) : null,
      status: String(row.status) as ExternalReviewStatus,
      reference: String(row.reference), reportUrl: row.report_url ? String(row.report_url) : null,
      summary: row.summary ? String(row.summary) : null,
      publicVisible: Boolean(row.public_visible), reviewedAt: iso(row.reviewed_at),
      validUntil: iso(row.valid_until)
    };
  }

  private mapIncident(row: Record<string, unknown>): TrustIncidentView {
    return {
      id: String(row.id), incidentKey: String(row.incident_key), category: String(row.category),
      severity: String(row.severity), status: String(row.status), title: String(row.title),
      summary: String(row.summary), publicVisible: Boolean(row.public_visible),
      publicNoticeUrl: row.public_notice_url ? String(row.public_notice_url) : null,
      detectedAt: new Date(String(row.detected_at)).toISOString(),
      containedAt: iso(row.contained_at), resolvedAt: iso(row.resolved_at)
    };
  }

  private mapGuardianRequest(row: Record<string, unknown> | undefined): GuardianRequestView {
    if (!row) throw new Error("Solicitação do responsável não pôde ser criada.");
    return {
      id: String(row.id), status: String(row.status), relationship: String(row.relationship),
      expiresAt: new Date(String(row.expires_at)).toISOString(),
      respondedAt: iso(row.responded_at),
      createdAt: new Date(String(row.created_at)).toISOString()
    };
  }
}
