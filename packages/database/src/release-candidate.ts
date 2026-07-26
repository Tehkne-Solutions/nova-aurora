import { createHash, randomBytes, randomUUID } from "node:crypto";
import { EconomyRepositoryBase, type Tx } from "./economy-base.js";
import { enqueueTransactionalEmail } from "./transactional-email.js";
import type { AuthenticatedIdentity } from "./auth-security.js";

export type BetaAccessState = "pending" | "invited" | "active" | "suspended";

export type ReleaseSecurityState = Readonly<{
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  emailVerificationRequired: boolean;
  emailVerificationSentAt: string | null;
  betaAccess: BetaAccessState;
  mfaEnabled: boolean;
}>;

export type BetaInviteView = Readonly<{
  id: string;
  label: string;
  emailPattern: string | null;
  maxUses: number;
  useCount: number;
  status: string;
  expiresAt: string | null;
  createdAt: string;
}>;

export type ReleaseGateView = Readonly<{
  key: string;
  label: string;
  status: string;
  evidence: unknown;
  notes: string | null;
  checkedAt: string | null;
  updatedAt: string;
}>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function registrationMode(): "open" | "invite-only" | "closed" {
  const configured = process.env.PUBLIC_REGISTRATION_MODE;
  if (configured === "open" || configured === "invite-only" || configured === "closed") {
    return configured;
  }
  return process.env.NODE_ENV === "production" ? "invite-only" : "open";
}

function publicWebUrl(): string {
  const value = process.env.PUBLIC_WEB_URL?.trim();
  if (value) return value.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") {
    throw new Error("PUBLIC_WEB_URL não configurada.");
  }
  return "http://localhost:3000";
}

function inviteMatches(pattern: string | null, email: string): boolean {
  if (!pattern) return true;
  const normalized = pattern.trim().toLowerCase();
  if (normalized.startsWith("*@")) return email.endsWith(normalized.slice(1));
  return normalized === email;
}

export class ReleaseCandidateService extends EconomyRepositoryBase {
  async assertRegistrationAllowed(emailInput: string, inviteCode?: string): Promise<void> {
    const mode = registrationMode();
    if (mode === "closed") throw new Error("Novos cadastros estão temporariamente fechados.");
    if (mode === "open") return;
    if (!inviteCode || inviteCode.trim().length < 8) {
      throw new Error("Convite de beta obrigatório.");
    }
    const email = normalizeEmail(emailInput);
    const rows = await this.sql`
      SELECT email_pattern,max_uses,use_count,status,expires_at
      FROM beta_invites WHERE code_hash=${sha256(inviteCode.trim())}
    `;
    const invite = rows[0];
    if (!invite
      || String(invite.status) !== "active"
      || Number(invite.use_count) >= Number(invite.max_uses)
      || (invite.expires_at && new Date(String(invite.expires_at)).getTime() <= Date.now())
      || !inviteMatches(invite.email_pattern ? String(invite.email_pattern) : null, email)) {
      throw new Error("Convite de beta inválido ou indisponível.");
    }
  }

  async completeRegistration(input: {
    identity: AuthenticatedIdentity;
    inviteCode?: string | undefined;
    ipAddress?: string | undefined;
    idempotencyKey: string;
  }): Promise<ReleaseSecurityState> {
    const email = normalizeEmail(input.identity.email);
    await this.sql.begin("isolation level serializable", async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`release:${input.idempotencyKey}`}))`;
      const state = await tx`
        SELECT email_verification_required,email_verified_at
        FROM users WHERE id=${input.identity.userId}::uuid FOR UPDATE
      `;
      if (Boolean(state[0]?.email_verification_required) && !state[0]?.email_verified_at) return;

      const mode = registrationMode();
      let access: BetaAccessState = mode === "open" ? "invited" : "pending";
      if (mode === "closed") {
        await tx`
          UPDATE users SET status='disabled',public_beta_access='suspended',updated_at=now()
          WHERE id=${input.identity.userId}::uuid
        `;
        throw new Error("Novos cadastros estão temporariamente fechados.");
      }
      if (mode === "invite-only") {
        if (!input.inviteCode) throw new Error("Convite de beta obrigatório.");
        const rows = await tx`
          SELECT * FROM beta_invites
          WHERE code_hash=${sha256(input.inviteCode.trim())}
          FOR UPDATE
        `;
        const invite = rows[0];
        if (!invite
          || String(invite.status) !== "active"
          || Number(invite.use_count) >= Number(invite.max_uses)
          || (invite.expires_at && new Date(String(invite.expires_at)).getTime() <= Date.now())
          || !inviteMatches(invite.email_pattern ? String(invite.email_pattern) : null, email)) {
          await tx`
            UPDATE users SET status='disabled',public_beta_access='suspended',updated_at=now()
            WHERE id=${input.identity.userId}::uuid
          `;
          throw new Error("Convite de beta inválido ou já utilizado.");
        }
        await tx`
          INSERT INTO beta_invite_redemptions (
            id,invite_id,user_id,email,redeemed_ip_hash
          ) VALUES (
            ${randomUUID()}::uuid,${String(invite.id)}::uuid,${input.identity.userId}::uuid,
            ${email},${input.ipAddress ? sha256(input.ipAddress) : null}
          )
        `;
        const nextUses = Number(invite.use_count) + 1;
        await tx`
          UPDATE beta_invites SET
            use_count=${nextUses},status=${nextUses >= Number(invite.max_uses) ? "exhausted" : "active"},
            updated_at=now()
          WHERE id=${String(invite.id)}::uuid
        `;
        access = "invited";
      }
      await tx`
        UPDATE users SET
          email_verified_at=NULL,email_verification_required=true,
          public_beta_access=${access},beta_access_updated_at=now(),updated_at=now()
        WHERE id=${input.identity.userId}::uuid
      `;
      await this.issueVerificationTx(tx, {
        userId: input.identity.userId,
        email,
        ipAddress: input.ipAddress,
        deliveryKey: `verify-registration:${input.idempotencyKey}`
      });
      await this.auditTx(tx, {
        actorUserId: input.identity.userId,
        sessionId: input.identity.sessionId,
        action: "release.registration.initialized",
        metadata: { mode, access }
      });
    });
    return this.securityState(input.identity.userId);
  }

  async resendVerification(input: {
    identity: AuthenticatedIdentity;
    ipAddress?: string | undefined;
  }): Promise<Readonly<{ accepted: true }>> {
    await this.sql.begin("isolation level serializable", async (tx) => {
      const rows = await tx`
        SELECT email,email_verified_at,email_verification_sent_at
        FROM users WHERE id=${input.identity.userId}::uuid FOR UPDATE
      `;
      const user = rows[0];
      if (!user) throw new Error("Conta não encontrada.");
      if (user.email_verified_at) return;
      if (user.email_verification_sent_at
        && Date.now() - new Date(String(user.email_verification_sent_at)).getTime() < 60_000) {
        throw new Error("Aguarde um minuto antes de solicitar novo envio.");
      }
      await this.issueVerificationTx(tx, {
        userId: input.identity.userId,
        email: String(user.email),
        ipAddress: input.ipAddress,
        deliveryKey: `verify-resend:${input.identity.userId}:${Math.floor(Date.now() / 60_000)}`
      });
      await this.auditTx(tx, {
        actorUserId: input.identity.userId,
        sessionId: input.identity.sessionId,
        action: "auth.email-verification.resend",
        metadata: {}
      });
    });
    return { accepted: true };
  }

  async confirmEmail(token: string): Promise<Readonly<{ verified: true }>> {
    await this.sql.begin("isolation level serializable", async (tx) => {
      const rows = await tx`
        SELECT verification.id,verification.user_id
        FROM email_verification_tokens verification
        JOIN users user_account ON user_account.id=verification.user_id
        WHERE verification.token_hash=${sha256(token)}
          AND verification.consumed_at IS NULL
          AND verification.expires_at>now()
          AND user_account.status='active'
        FOR UPDATE OF verification
      `;
      const verification = rows[0];
      if (!verification) throw new Error("Token de verificação inválido ou expirado.");
      const userId = String(verification.user_id);
      await tx`
        UPDATE email_verification_tokens SET consumed_at=now()
        WHERE user_id=${userId}::uuid AND consumed_at IS NULL
      `;
      await tx`
        UPDATE users SET
          email_verified_at=now(),email_verification_required=false,
          public_beta_access='active',beta_access_updated_at=now(),updated_at=now()
        WHERE id=${userId}::uuid
      `;
      await this.auditTx(tx, {
        actorUserId: userId,
        sessionId: null,
        action: "auth.email-verification.complete",
        metadata: { betaAccess: "active" }
      });
    });
    return { verified: true };
  }

  async assertMutableAccess(userId: string): Promise<void> {
    const rows = await this.sql`
      SELECT status,email_verified_at,email_verification_required,public_beta_access
      FROM users WHERE id=${userId}::uuid
    `;
    const user = rows[0];
    if (!user || String(user.status) !== "active") throw new Error("Conta indisponível.");
    if (Boolean(user.email_verification_required) || !user.email_verified_at) {
      throw new Error("Confirme seu e-mail antes de realizar esta operação.");
    }
    if (String(user.public_beta_access) !== "active") {
      throw new Error("Acesso ao beta não está ativo para esta conta.");
    }
  }

  async securityState(userId: string): Promise<ReleaseSecurityState> {
    const rows = await this.sql`
      SELECT email_verified_at,email_verification_required,email_verification_sent_at,
        public_beta_access,mfa_enabled
      FROM users WHERE id=${userId}::uuid
    `;
    const row = rows[0];
    if (!row) throw new Error("Conta não encontrada.");
    return {
      emailVerified: Boolean(row.email_verified_at),
      emailVerifiedAt: row.email_verified_at
        ? new Date(String(row.email_verified_at)).toISOString()
        : null,
      emailVerificationRequired: Boolean(row.email_verification_required),
      emailVerificationSentAt: row.email_verification_sent_at
        ? new Date(String(row.email_verification_sent_at)).toISOString()
        : null,
      betaAccess: String(row.public_beta_access) as BetaAccessState,
      mfaEnabled: Boolean(row.mfa_enabled)
    };
  }

  async createInvite(input: {
    actorId: string;
    label: string;
    emailPattern?: string | undefined;
    maxUses: number;
    expiresAt?: string | undefined;
  }): Promise<Readonly<{ invite: BetaInviteView; code: string }>> {
    const code = `AURORA-${randomBytes(12).toString("base64url").toUpperCase()}`;
    const id = randomUUID();
    await this.sql`
      INSERT INTO beta_invites (
        id,code_hash,label,email_pattern,max_uses,expires_at,created_by
      ) VALUES (
        ${id}::uuid,${sha256(code)},${input.label.trim().slice(0,160)},
        ${input.emailPattern?.trim().toLowerCase() ?? null},${input.maxUses},
        ${input.expiresAt ?? null},${input.actorId}::uuid
      )
    `;
    const invite = (await this.invites()).find((item) => item.id === id);
    if (!invite) throw new Error("Convite não pôde ser criado.");
    return { invite, code };
  }

  async invites(): Promise<readonly BetaInviteView[]> {
    const rows = await this.sql`
      SELECT id,label,email_pattern,max_uses,use_count,status,expires_at,created_at
      FROM beta_invites ORDER BY created_at DESC LIMIT 200
    `;
    return rows.map((row) => ({
      id: String(row.id),
      label: String(row.label),
      emailPattern: row.email_pattern ? String(row.email_pattern) : null,
      maxUses: Number(row.max_uses),
      useCount: Number(row.use_count),
      status: String(row.status),
      expiresAt: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
      createdAt: new Date(String(row.created_at)).toISOString()
    }));
  }

  async gates(): Promise<readonly ReleaseGateView[]> {
    const rows = await this.sql`
      SELECT gate_key,label,status,evidence,notes,checked_at,updated_at
      FROM release_gate_checks ORDER BY gate_key
    `;
    return rows.map((row) => ({
      key: String(row.gate_key),
      label: String(row.label),
      status: String(row.status),
      evidence: row.evidence,
      notes: row.notes ? String(row.notes) : null,
      checkedAt: row.checked_at ? new Date(String(row.checked_at)).toISOString() : null,
      updatedAt: new Date(String(row.updated_at)).toISOString()
    }));
  }

  async updateGate(input: {
    actorId: string;
    key: string;
    status: "pending" | "passing" | "blocked" | "waived";
    evidence?: unknown;
    notes?: string | undefined;
  }): Promise<void> {
    const rows = await this.sql`
      UPDATE release_gate_checks SET
        status=${input.status},evidence=${JSON.stringify(input.evidence ?? {})}::jsonb,
        notes=${input.notes?.slice(0,2000) ?? null},checked_at=now(),
        updated_by=${input.actorId}::uuid,updated_at=now()
      WHERE gate_key=${input.key}
      RETURNING gate_key
    `;
    if (!rows[0]) throw new Error("Gate de release não encontrado.");
  }

  private async issueVerificationTx(tx: Tx, input: {
    userId: string;
    email: string;
    ipAddress?: string | undefined;
    deliveryKey: string;
  }): Promise<void> {
    const token = randomBytes(32).toString("base64url");
    const tokenId = randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await tx`
      UPDATE email_verification_tokens SET consumed_at=COALESCE(consumed_at,now())
      WHERE user_id=${input.userId}::uuid AND consumed_at IS NULL
    `;
    await tx`
      INSERT INTO email_verification_tokens (
        id,user_id,token_hash,requested_ip_hash,expires_at
      ) VALUES (
        ${tokenId}::uuid,${input.userId}::uuid,${sha256(token)},
        ${input.ipAddress ? sha256(input.ipAddress) : null},${expiresAt.toISOString()}
      )
    `;
    await enqueueTransactionalEmail(tx, {
      deliveryKey: input.deliveryKey,
      userId: input.userId,
      recipient: input.email,
      template: "verify-email",
      subject: "Confirme seu acesso à Nova Aurora",
      payload: {
        verificationUrl: `${publicWebUrl()}/verify-email?token=${encodeURIComponent(token)}`,
        expiresAt: expiresAt.toISOString(),
        signature: "Tehkné Solutions"
      }
    });
    await tx`
      UPDATE users SET email_verification_sent_at=now(),updated_at=now()
      WHERE id=${input.userId}::uuid
    `;
  }

  private async auditTx(tx: Tx, input: {
    actorUserId: string;
    sessionId: string | null;
    action: string;
    metadata: unknown;
  }): Promise<void> {
    await tx`
      INSERT INTO security_audit_log (
        actor_user_id,subject_user_id,session_id,action,outcome,risk_level,metadata
      ) VALUES (
        ${input.actorUserId}::uuid,${input.actorUserId}::uuid,${input.sessionId}::uuid,
        ${input.action},'success','low',${JSON.stringify(input.metadata)}::jsonb
      )
    `;
  }
}
