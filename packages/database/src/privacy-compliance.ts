import { randomUUID } from "node:crypto";
import { EconomyRepositoryBase, type Tx } from "./economy-base.js";
import type { AuthenticatedIdentity } from "./auth-security.js";

export type ConsentPurpose =
  | "terms"
  | "privacy"
  | "essential-processing"
  | "analytics"
  | "marketing"
  | "blockchain-research";

export type PrivacyState = Readonly<{
  mfaEnabled: boolean;
  deletionScheduledAt: string | null;
  consents: readonly Readonly<{
    purpose: ConsentPurpose;
    version: string;
    status: "granted" | "denied" | "withdrawn";
    updatedAt: string;
  }>[];
  requests: readonly Readonly<{
    id: string;
    requestType: "export" | "deletion";
    status: string;
    requestedAt: string;
    scheduledFor: string | null;
    completedAt: string | null;
  }>[];
  retention: readonly Readonly<{
    category: string;
    retentionDays: number;
    description: string;
  }>[];
}>;

export class PrivacyComplianceService extends EconomyRepositoryBase {
  async state(userId: string): Promise<PrivacyState> {
    const [users, consents, requests, retention] = await Promise.all([
      this.sql`
        SELECT mfa_enabled,deletion_scheduled_at FROM users WHERE id=${userId}::uuid
      `,
      this.sql`
        SELECT purpose,version,status,updated_at
        FROM user_consents WHERE user_id=${userId}::uuid ORDER BY purpose
      `,
      this.sql`
        SELECT id,request_type,status,requested_at,scheduled_for,completed_at
        FROM privacy_requests WHERE user_id=${userId}::uuid
        ORDER BY requested_at DESC LIMIT 50
      `,
      this.sql`
        SELECT data_category,retention_days,description
        FROM data_retention_policies ORDER BY data_category
      `
    ]);
    const user = users[0];
    if (!user) throw new Error("Usuário não encontrado.");
    return {
      mfaEnabled: Boolean(user.mfa_enabled),
      deletionScheduledAt: user.deletion_scheduled_at
        ? new Date(String(user.deletion_scheduled_at)).toISOString()
        : null,
      consents: consents.map((row) => ({
        purpose: String(row.purpose) as ConsentPurpose,
        version: String(row.version),
        status: String(row.status) as "granted" | "denied" | "withdrawn",
        updatedAt: new Date(String(row.updated_at)).toISOString()
      })),
      requests: requests.map((row) => ({
        id: String(row.id),
        requestType: String(row.request_type) as "export" | "deletion",
        status: String(row.status),
        requestedAt: new Date(String(row.requested_at)).toISOString(),
        scheduledFor: row.scheduled_for
          ? new Date(String(row.scheduled_for)).toISOString()
          : null,
        completedAt: row.completed_at
          ? new Date(String(row.completed_at)).toISOString()
          : null
      })),
      retention: retention.map((row) => ({
        category: String(row.data_category),
        retentionDays: Number(row.retention_days),
        description: String(row.description)
      }))
    };
  }

  async setConsent(input: {
    identity: AuthenticatedIdentity;
    purpose: ConsentPurpose;
    version: string;
    status: "granted" | "denied" | "withdrawn";
    source?: string | undefined;
  }): Promise<PrivacyState> {
    if (input.purpose === "essential-processing" && input.status !== "granted") {
      throw new Error("O processamento essencial é necessário para manter a conta ativa.");
    }
    const source = input.source?.slice(0, 80) ?? "account-center";
    await this.sql.begin(async (tx) => {
      await tx`
        INSERT INTO user_consents (user_id,purpose,version,status,source,updated_at)
        VALUES (
          ${input.identity.userId}::uuid,${input.purpose},${input.version.slice(0,40)},
          ${input.status},${source},now()
        )
        ON CONFLICT (user_id,purpose) DO UPDATE SET
          version=EXCLUDED.version,status=EXCLUDED.status,source=EXCLUDED.source,updated_at=now()
      `;
      await tx`
        INSERT INTO consent_history (user_id,purpose,version,status,source)
        VALUES (
          ${input.identity.userId}::uuid,${input.purpose},${input.version.slice(0,40)},
          ${input.status},${source}
        )
      `;
      await tx`
        INSERT INTO security_audit_log (
          actor_user_id,subject_user_id,session_id,action,resource_type,resource_id,
          outcome,risk_level,metadata
        ) VALUES (
          ${input.identity.userId}::uuid,${input.identity.userId}::uuid,
          ${input.identity.sessionId}::uuid,'privacy.consent.update','consent',${input.purpose},
          'success','low',${JSON.stringify({ version: input.version, status: input.status })}::jsonb
        )
      `;
    });
    return this.state(input.identity.userId);
  }

  async requestExport(identity: AuthenticatedIdentity): Promise<Readonly<{
    requestId: string;
    generatedAt: string;
    data: unknown;
  }>> {
    const requestId = randomUUID();
    const generatedAt = new Date().toISOString();
    const [profile, roles, consents, companies, accounts, entries, orders, trades, notifications] =
      await Promise.all([
        this.sql`
          SELECT id,email,display_name,status,email_verified_at,last_login_at,created_at,updated_at
          FROM users WHERE id=${identity.userId}::uuid
        `,
        this.sql`
          SELECT role,granted_at,expires_at FROM user_roles
          WHERE user_id=${identity.userId}::uuid ORDER BY role
        `,
        this.sql`
          SELECT purpose,version,status,source,updated_at FROM user_consents
          WHERE user_id=${identity.userId}::uuid ORDER BY purpose
        `,
        this.sql`
          SELECT id,name,created_at FROM companies
          WHERE owner_id=${identity.userId}::uuid ORDER BY created_at
        `,
        this.sql`
          SELECT id,code,account_type,created_at FROM ledger_accounts
          WHERE owner_id=${identity.userId}::uuid ORDER BY created_at
        `,
        this.sql`
          SELECT entry.id,entry.transaction_id,entry.amount_minor,entry.memo,entry.created_at,
            account.code account_code
          FROM ledger_entries entry
          JOIN ledger_accounts account ON account.id=entry.account_id
          WHERE account.owner_id=${identity.userId}::uuid
          ORDER BY entry.created_at DESC LIMIT 10000
        `,
        this.sql`
          SELECT orders.id,orders.side,item.code item_code,orders.quantity_minor,
            orders.filled_minor,orders.unit_price_minor,orders.status,orders.created_at
          FROM market_orders orders JOIN items item ON item.id=orders.item_id
          WHERE orders.owner_id=${identity.userId}::uuid ORDER BY orders.created_at DESC
          LIMIT 5000
        `,
        this.sql`
          SELECT trade.id,item.code item_code,trade.quantity_minor,trade.unit_price_minor,
            trade.gross_minor,trade.tax_minor,trade.created_at,
            CASE WHEN trade.buyer_id=${identity.userId}::uuid THEN 'buyer' ELSE 'seller' END role
          FROM market_trades trade JOIN items item ON item.id=trade.item_id
          WHERE trade.buyer_id=${identity.userId}::uuid OR trade.seller_id=${identity.userId}::uuid
          ORDER BY trade.created_at DESC LIMIT 5000
        `,
        this.sql`
          SELECT id,event_type,title,body,severity,read_at,created_at
          FROM user_notifications WHERE user_id=${identity.userId}::uuid
          ORDER BY created_at DESC LIMIT 5000
        `
      ]);
    const data = {
      product: "Nova Aurora",
      generatedAt,
      signature: "Tehkné Solutions",
      profile: profile[0] ?? null,
      roles,
      consents,
      companies,
      ledger: { accounts, entries },
      market: { orders, trades },
      notifications
    };
    await this.sql`
      INSERT INTO privacy_requests (
        id,user_id,request_type,status,export_payload,completed_at
      ) VALUES (
        ${requestId}::uuid,${identity.userId}::uuid,'export','ready',
        ${JSON.stringify(data)}::jsonb,now()
      )
    `;
    await this.audit(identity, "privacy.export.complete", requestId, { generatedAt });
    return { requestId, generatedAt, data };
  }

  async scheduleDeletion(input: {
    identity: AuthenticatedIdentity;
    reason?: string | undefined;
  }): Promise<Readonly<{ requestId: string; scheduledFor: string }>> {
    const requestId = randomUUID();
    const scheduledFor = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.sql.begin("isolation level serializable", async (tx) => {
      const holds = await tx`
        SELECT id FROM user_legal_holds
        WHERE user_id=${input.identity.userId}::uuid
          AND released_at IS NULL AND (expires_at IS NULL OR expires_at>now())
        LIMIT 1
      `;
      if (holds[0]) throw new Error("A conta possui retenção obrigatória ativa.");
      const existing = await tx`
        SELECT id FROM privacy_requests
        WHERE user_id=${input.identity.userId}::uuid AND request_type='deletion'
          AND status='scheduled' FOR UPDATE
      `;
      if (existing[0]) throw new Error("Já existe uma exclusão agendada.");

      await this.releaseEconomicReservations(tx, input.identity.userId);
      await tx`
        UPDATE market_orders SET status='cancelled',cancelled_at=now(),updated_at=now()
        WHERE owner_id=${input.identity.userId}::uuid AND status IN ('open','partial')
      `;
      await tx`
        UPDATE production_orders SET status='cancelled',cancelled_at=now(),updated_at=now()
        WHERE owner_id=${input.identity.userId}::uuid AND status IN ('queued','processing')
      `;
      await tx`
        UPDATE auth_sessions SET status='revoked',revoked_at=now()
        WHERE user_id=${input.identity.userId}::uuid AND status='active'
      `;
      await tx`
        UPDATE live_presence SET status='offline',last_heartbeat_at=now()
        WHERE user_id=${input.identity.userId}::uuid
      `;
      await tx`
        UPDATE users SET status='suspended',deletion_scheduled_at=${scheduledFor.toISOString()},updated_at=now()
        WHERE id=${input.identity.userId}::uuid
      `;
      await tx`
        INSERT INTO user_risk_profiles (user_id,economic_status,review_reason,updated_at)
        VALUES (${input.identity.userId}::uuid,'frozen','privacy-deletion',now())
        ON CONFLICT (user_id) DO UPDATE SET
          economic_status='frozen',review_reason='privacy-deletion',updated_at=now()
      `;
      await tx`
        INSERT INTO privacy_requests (
          id,user_id,request_type,status,reason,scheduled_for
        ) VALUES (
          ${requestId}::uuid,${input.identity.userId}::uuid,'deletion','scheduled',
          ${input.reason?.slice(0,500) ?? null},${scheduledFor.toISOString()}
        )
      `;
    });
    await this.audit(input.identity, "privacy.deletion.schedule", requestId, {
      scheduledFor: scheduledFor.toISOString()
    });
    return { requestId, scheduledFor: scheduledFor.toISOString() };
  }

  async cancelDeletion(identity: AuthenticatedIdentity): Promise<PrivacyState> {
    await this.sql.begin("isolation level serializable", async (tx) => {
      const rows = await tx`
        UPDATE privacy_requests SET status='cancelled',cancelled_at=now()
        WHERE user_id=${identity.userId}::uuid AND request_type='deletion'
          AND status='scheduled' AND scheduled_for>now()
        RETURNING id
      `;
      if (!rows[0]) throw new Error("Nenhuma exclusão cancelável foi encontrada.");
      await tx`
        UPDATE users SET status='active',deletion_scheduled_at=NULL,updated_at=now()
        WHERE id=${identity.userId}::uuid
      `;
      await tx`
        UPDATE user_risk_profiles SET economic_status='normal',review_reason=NULL,updated_at=now()
        WHERE user_id=${identity.userId}::uuid AND review_reason='privacy-deletion'
      `;
    });
    await this.audit(identity, "privacy.deletion.cancel", identity.userId, {});
    return this.state(identity.userId);
  }

  async processDueDeletions(limit = 25): Promise<number> {
    const rows = await this.sql`
      SELECT request.id,request.user_id
      FROM privacy_requests request
      WHERE request.request_type='deletion' AND request.status='scheduled'
        AND request.scheduled_for<=now()
        AND NOT EXISTS (
          SELECT 1 FROM user_legal_holds hold_record
          WHERE hold_record.user_id=request.user_id AND hold_record.released_at IS NULL
            AND (hold_record.expires_at IS NULL OR hold_record.expires_at>now())
        )
      ORDER BY request.scheduled_for LIMIT ${Math.min(Math.max(limit,1),100)}
    `;
    let completed = 0;
    for (const row of rows) {
      await this.anonymizeUser(String(row.user_id), String(row.id));
      completed += 1;
    }
    return completed;
  }

  async createLegalHold(input: {
    actorId: string;
    userId: string;
    reason: string;
    expiresAt?: string | undefined;
  }): Promise<string> {
    const id = randomUUID();
    await this.sql`
      INSERT INTO user_legal_holds (id,user_id,reason,created_by,expires_at)
      VALUES (
        ${id}::uuid,${input.userId}::uuid,${input.reason.slice(0,1000)},
        ${input.actorId}::uuid,${input.expiresAt ?? null}
      )
    `;
    return id;
  }

  async releaseLegalHold(input: { actorId: string; holdId: string }): Promise<void> {
    const rows = await this.sql`
      UPDATE user_legal_holds SET released_at=now()
      WHERE id=${input.holdId}::uuid AND released_at IS NULL RETURNING user_id
    `;
    if (!rows[0]) throw new Error("Retenção não encontrada ou já liberada.");
  }

  private async releaseEconomicReservations(tx: Tx, userId: string): Promise<void> {
    const inventory = await tx`
      SELECT reservation.id,reservation.resource_id,reservation.remaining_minor
      FROM reservations reservation
      WHERE reservation.owner_id=${userId}::uuid
        AND reservation.resource_type='inventory' AND reservation.status='active'
      FOR UPDATE
    `;
    for (const reservation of inventory) {
      await tx`
        UPDATE inventory_lots
        SET reserved_minor=GREATEST(0,reserved_minor-${Number(reservation.remaining_minor)})
        WHERE id=${String(reservation.resource_id)}::uuid
      `;
    }
    await tx`
      UPDATE reservations SET remaining_minor=0,status='released',updated_at=now()
      WHERE owner_id=${userId}::uuid AND status='active'
    `;
  }

  private async anonymizeUser(userId: string, requestId: string): Promise<void> {
    await this.sql.begin("isolation level serializable", async (tx) => {
      const locked = await tx`SELECT id FROM privacy_requests WHERE id=${requestId}::uuid FOR UPDATE`;
      if (!locked[0]) return;
      const anonymousEmail = `deleted+${userId}@privacy.invalid`;
      await tx`DELETE FROM auth_sessions WHERE user_id=${userId}::uuid`;
      await tx`DELETE FROM account_recovery_tokens WHERE user_id=${userId}::uuid`;
      await tx`DELETE FROM mfa_login_challenges WHERE user_id=${userId}::uuid`;
      await tx`DELETE FROM user_mfa WHERE user_id=${userId}::uuid`;
      await tx`DELETE FROM mfa_recovery_codes WHERE user_id=${userId}::uuid`;
      await tx`DELETE FROM live_presence WHERE user_id=${userId}::uuid`;
      await tx`DELETE FROM user_notifications WHERE user_id=${userId}::uuid`;
      await tx`
        UPDATE user_consents SET status='withdrawn',source='privacy-deletion',updated_at=now()
        WHERE user_id=${userId}::uuid AND purpose<>'essential-processing'
      `;
      await tx`
        UPDATE companies SET name=${`Empresa encerrada ${userId.slice(0,8)}`}
        WHERE owner_id=${userId}::uuid
      `;
      await tx`
        UPDATE users SET
          email=${anonymousEmail},display_name='Usuário removido',
          password_hash=crypt(encode(gen_random_bytes(32),'hex'),gen_salt('bf',12)),
          status='disabled',mfa_enabled=false,mfa_verified_at=NULL,
          deletion_scheduled_at=NULL,anonymized_at=now(),updated_at=now()
        WHERE id=${userId}::uuid
      `;
      await tx`
        UPDATE user_risk_profiles SET economic_status='frozen',review_reason='privacy-deleted',updated_at=now()
        WHERE user_id=${userId}::uuid
      `;
      await tx`
        UPDATE privacy_requests SET status='completed',completed_at=now(),export_payload=NULL
        WHERE id=${requestId}::uuid
      `;
      await tx`
        INSERT INTO security_audit_log (
          actor_user_id,subject_user_id,action,resource_type,resource_id,
          outcome,risk_level,metadata
        ) VALUES (
          NULL,${userId}::uuid,'privacy.deletion.complete','privacy-request',${requestId},
          'success','high','{"pseudonymized":true,"economicRecordsPreserved":true}'::jsonb
        )
      `;
    });
  }

  private async audit(
    identity: AuthenticatedIdentity,
    action: string,
    resourceId: string,
    metadata: unknown
  ): Promise<void> {
    await this.sql`
      INSERT INTO security_audit_log (
        actor_user_id,subject_user_id,session_id,action,resource_type,resource_id,
        outcome,risk_level,metadata
      ) VALUES (
        ${identity.userId}::uuid,${identity.userId}::uuid,${identity.sessionId}::uuid,
        ${action},'privacy-request',${resourceId},'success','medium',
        ${JSON.stringify(metadata)}::jsonb
      )
    `;
  }
}
