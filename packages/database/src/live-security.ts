import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  AuthSecurityService,
  type AuthenticatedIdentity,
  type AuthSessionResult,
  type UserRole
} from "./auth-security.js";
import type { Tx } from "./economy-base.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function safeDevice(value: string | undefined): string | null {
  const normalized = value?.trim().slice(0, 120);
  return normalized ? normalized : null;
}

export class LiveSecurityService extends AuthSecurityService {
  override async register(input: {
    email: string;
    displayName: string;
    password: string;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
    deviceName?: string | undefined;
    idempotencyKey: string;
  }): Promise<AuthSessionResult> {
    const email = normalizeEmail(input.email);
    const displayName = input.displayName.trim().slice(0, 120);
    if (displayName.length < 2) throw new Error("Nome público inválido.");
    if (input.password.length < 12) {
      throw new Error("A senha deve possuir pelo menos 12 caracteres.");
    }

    const result = await this.sql.begin("isolation level serializable", async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`register:${input.idempotencyKey}`}))`;
      const replayRows = await tx`
        SELECT record.email,record.user_id,user_account.display_name,user_account.status,
          user_account.password_hash=crypt(${input.password},user_account.password_hash) valid_password
        FROM registration_idempotency record
        JOIN users user_account ON user_account.id=record.user_id
        WHERE record.idempotency_key=${input.idempotencyKey}
        FOR UPDATE OF record
      `;
      const replay = replayRows[0];
      if (replay) {
        if (String(replay.email) !== email
          || !Boolean(replay.valid_password)
          || String(replay.status) !== "active") {
          throw new Error("Idempotency-Key reutilizada com outro cadastro.");
        }
        const roles = await this.rolesFor(tx, String(replay.user_id));
        const session = await this.createLiveSession(tx, {
          userId: String(replay.user_id),
          email,
          displayName: String(replay.display_name),
          roles,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          deviceName: input.deviceName
        });
        await this.auditTx(tx, {
          actorUserId: String(replay.user_id),
          subjectUserId: String(replay.user_id),
          sessionId: session.identity.sessionId,
          action: "auth.register.replayed",
          outcome: "success",
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          metadata: { idempotencyKey: input.idempotencyKey }
        });
        return session;
      }

      const existing = await tx`SELECT id FROM users WHERE email=${email}`;
      if (existing[0]) throw new Error("Não foi possível criar esta conta.");

      const userId = randomUUID();
      const companyId = randomUUID();
      const walletId = randomUUID();
      await tx`
        INSERT INTO users (
          id,email,display_name,password_hash,status,email_verified_at,
          password_updated_at,updated_at
        ) VALUES (
          ${userId}::uuid,${email},${displayName},
          crypt(${input.password},gen_salt('bf',12)),'active',now(),now(),now()
        )
      `;
      await tx`
        INSERT INTO companies (id,owner_id,name)
        VALUES (${companyId}::uuid,${userId}::uuid,${`${displayName} Empreendimentos`.slice(0,160)})
      `;
      await tx`
        INSERT INTO ledger_accounts (id,code,owner_id,account_type)
        VALUES (${walletId}::uuid,${`user.${userId}.wallet`},${userId}::uuid,'wallet')
      `;
      await tx`
        INSERT INTO civic_reputation (user_id,score) VALUES (${userId}::uuid,50)
        ON CONFLICT (user_id) DO NOTHING
      `;
      await tx`
        INSERT INTO user_roles (user_id,role) VALUES
          (${userId}::uuid,'citizen'),(${userId}::uuid,'company-owner')
      `;
      await tx`
        INSERT INTO registration_idempotency (idempotency_key,email,user_id)
        VALUES (${input.idempotencyKey},${email},${userId}::uuid)
      `;
      const roles: readonly UserRole[] = ["citizen", "company-owner"];
      const session = await this.createLiveSession(tx, {
        userId,
        email,
        displayName,
        roles,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        deviceName: input.deviceName
      });
      await this.auditTx(tx, {
        actorUserId: userId,
        subjectUserId: userId,
        sessionId: session.identity.sessionId,
        action: "auth.register",
        outcome: "success",
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: { email }
      });
      await this.outbox(tx, userId, "security.user.registered", {
        userId,
        email,
        signature: "Tehkné Solutions"
      });
      return session;
    });
    return result as AuthSessionResult;
  }

  override async consumeRateLimit(input: {
    scopeKey: string;
    action: string;
    limit: number;
    windowSeconds: number;
    blockSeconds: number;
  }): Promise<Readonly<{ remaining: number; resetAt: string }>> {
    const now = Date.now();
    const windowMs = input.windowSeconds * 1000;
    const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
    const result = await this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`${input.scopeKey}:${input.action}`}))`;
      const rows = await tx`
        INSERT INTO rate_limit_windows (
          scope_key,action,window_started_at,request_count,updated_at
        ) VALUES (${input.scopeKey},${input.action},${windowStart.toISOString()},1,now())
        ON CONFLICT (scope_key,action,window_started_at) DO UPDATE SET
          request_count=rate_limit_windows.request_count+1,updated_at=now()
        RETURNING request_count,blocked_until
      `;
      const count = Number(rows[0]?.request_count ?? 1);
      const existingBlockedUntil = rows[0]?.blocked_until
        ? new Date(String(rows[0].blocked_until))
        : null;
      let blockedUntil = existingBlockedUntil;
      if (count > input.limit && (!blockedUntil || blockedUntil.getTime() <= now)) {
        blockedUntil = new Date(now + input.blockSeconds * 1000);
        await tx`
          UPDATE rate_limit_windows SET blocked_until=${blockedUntil.toISOString()}
          WHERE scope_key=${input.scopeKey} AND action=${input.action}
            AND window_started_at=${windowStart.toISOString()}
        `;
      }
      return {
        allowed: count <= input.limit && (!blockedUntil || blockedUntil.getTime() <= now),
        remaining: Math.max(0, input.limit - count),
        resetAt: new Date(windowStart.getTime() + windowMs).toISOString()
      };
    });
    const rate = result as Readonly<{
      allowed: boolean;
      remaining: number;
      resetAt: string;
    }>;
    if (!rate.allowed) {
      throw new Error("Muitas tentativas. Aguarde antes de tentar novamente.");
    }
    return { remaining: rate.remaining, resetAt: rate.resetAt };
  }

  async assertProductionSecurity(): Promise<void> {
    if (process.env.NODE_ENV !== "production") return;
    const rows = await this.sql`
      SELECT email FROM users
      WHERE (email='alice@nova-aurora.local'
          AND password_hash=crypt('Aurora@2026',password_hash))
         OR (email='bob@nova-aurora.local'
          AND password_hash=crypt('Horizonte@2026',password_hash))
    `;
    if (rows.length > 0) {
      throw new Error(
        "Deploy bloqueado: credenciais demonstrativas ainda estão ativas. "
        + "Altere as senhas antes de iniciar em produção."
      );
    }
  }

  async createRealtimeTicket(identity: AuthenticatedIdentity): Promise<Readonly<{
    ticket: string;
    expiresAt: string;
  }>> {
    const ticket = randomBytes(24).toString("base64url");
    const ticketId = randomUUID();
    const expiresAt = new Date(Date.now() + 60_000);
    await this.sql`
      INSERT INTO realtime_access_tickets (
        id,session_id,user_id,token_hash,expires_at
      ) VALUES (
        ${ticketId}::uuid,${identity.sessionId}::uuid,${identity.userId}::uuid,
        ${sha256(ticket)},${expiresAt.toISOString()}
      )
    `;
    await this.audit({
      actorUserId: identity.userId,
      subjectUserId: identity.userId,
      sessionId: identity.sessionId,
      action: "realtime.ticket.create",
      resourceType: "realtime-ticket",
      resourceId: ticketId,
      outcome: "success"
    });
    return { ticket, expiresAt: expiresAt.toISOString() };
  }

  async consumeRealtimeTicket(ticket: string): Promise<AuthenticatedIdentity> {
    const result = await this.sql.begin(async (tx) => {
      const rows = await tx`
        SELECT access.id,access.session_id,access.user_id,access.expires_at,
          session.status session_status,session.expires_at session_expires_at,
          user_account.email,user_account.display_name,user_account.status user_status
        FROM realtime_access_tickets access
        JOIN auth_sessions session ON session.id=access.session_id
        JOIN users user_account ON user_account.id=access.user_id
        WHERE access.token_hash=${sha256(ticket)} AND access.consumed_at IS NULL
        FOR UPDATE OF access
      `;
      const row = rows[0];
      if (!row
        || new Date(String(row.expires_at)).getTime() <= Date.now()
        || new Date(String(row.session_expires_at)).getTime() <= Date.now()
        || String(row.session_status) !== "active"
        || String(row.user_status) !== "active") {
        throw new Error("Ticket de tempo real inválido ou expirado.");
      }
      await tx`
        UPDATE realtime_access_tickets SET consumed_at=now()
        WHERE id=${String(row.id)}::uuid
      `;
      const roles = await this.rolesFor(tx, String(row.user_id));
      return {
        userId: String(row.user_id),
        email: String(row.email),
        displayName: String(row.display_name),
        sessionId: String(row.session_id),
        roles,
        expiresAt: new Date(String(row.session_expires_at)).toISOString()
      } satisfies AuthenticatedIdentity;
    });
    return result as AuthenticatedIdentity;
  }

  async disconnectPresence(identity: AuthenticatedIdentity): Promise<void> {
    await this.sql`
      UPDATE live_presence SET status='offline',last_heartbeat_at=now()
      WHERE user_id=${identity.userId}::uuid AND session_id=${identity.sessionId}::uuid
    `;
  }

  private async createLiveSession(tx: Tx, input: {
    userId: string;
    email: string;
    displayName: string;
    roles: readonly UserRole[];
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
    deviceName?: string | undefined;
  }): Promise<AuthSessionResult> {
    const token = randomBytes(32).toString("base64url");
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await tx`
      INSERT INTO auth_sessions (
        id,user_id,token_hash,status,ip_hash,user_agent_hash,device_name,expires_at
      ) VALUES (
        ${sessionId}::uuid,${input.userId}::uuid,${sha256(token)},'active',
        ${input.ipAddress ? sha256(input.ipAddress) : null},
        ${input.userAgent ? sha256(input.userAgent) : null},
        ${safeDevice(input.deviceName)},${expiresAt.toISOString()}
      )
    `;
    return {
      token,
      identity: {
        userId: input.userId,
        email: input.email,
        displayName: input.displayName,
        sessionId,
        roles: input.roles,
        expiresAt: expiresAt.toISOString()
      }
    };
  }

  private async rolesFor(tx: Tx, userId: string): Promise<readonly UserRole[]> {
    const rows = await tx`
      SELECT role FROM user_roles
      WHERE user_id=${userId}::uuid AND (expires_at IS NULL OR expires_at>now())
      ORDER BY role
    `;
    return rows.map((row) => String(row.role) as UserRole);
  }

  private async auditTx(tx: Tx, input: {
    actorUserId: string;
    subjectUserId: string;
    sessionId: string;
    action: string;
    outcome: "success" | "denied" | "failure";
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
    metadata?: unknown;
  }): Promise<void> {
    await tx`
      INSERT INTO security_audit_log (
        actor_user_id,subject_user_id,session_id,action,outcome,risk_level,
        ip_hash,user_agent_hash,metadata
      ) VALUES (
        ${input.actorUserId}::uuid,${input.subjectUserId}::uuid,${input.sessionId}::uuid,
        ${input.action},${input.outcome},'low',
        ${input.ipAddress ? sha256(input.ipAddress) : null},
        ${input.userAgent ? sha256(input.userAgent) : null},
        ${JSON.stringify(input.metadata ?? {})}::jsonb
      )
    `;
  }
}
