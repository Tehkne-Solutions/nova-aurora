import { createHash, randomBytes, randomUUID } from "node:crypto";
import { EconomyRepositoryBase, type Tx } from "./economy-base.js";

export type UserRole =
  | "citizen"
  | "company-owner"
  | "employee"
  | "council-member"
  | "municipal-admin"
  | "platform-admin";

export type AuthenticatedIdentity = Readonly<{
  userId: string;
  email: string;
  displayName: string;
  sessionId: string;
  roles: readonly UserRole[];
  expiresAt: string;
}>;

export type AuthSessionResult = Readonly<{
  token: string;
  identity: AuthenticatedIdentity;
}>;

export type NotificationView = Readonly<{
  id: string;
  eventType: string;
  title: string;
  body: string;
  severity: string;
  payload: unknown;
  readAt: string | null;
  createdAt: string;
}>;

export type PresenceView = Readonly<{
  userId: string;
  displayName: string;
  locationCode: string | null;
  status: string;
  lastHeartbeatAt: string;
}>;

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

export class AuthSecurityService extends EconomyRepositoryBase {
  async register(input: {
    email: string;
    displayName: string;
    password: string;
    ipAddress?: string;
    userAgent?: string;
    deviceName?: string;
    idempotencyKey: string;
  }): Promise<AuthSessionResult> {
    const email = normalizeEmail(input.email);
    if (input.password.length < 12) {
      throw new Error("A senha deve possuir pelo menos 12 caracteres.");
    }
    const result = await this.sql.begin("isolation level serializable", async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`register:${email}`}))`;
      const old = await tx`
        SELECT response FROM idempotency_records WHERE key=${input.idempotencyKey}
      `;
      if (old[0]) return old[0].response as AuthSessionResult;
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
          ${userId}::uuid,${email},${input.displayName.trim().slice(0,120)},
          crypt(${input.password},gen_salt('bf',12)),'active',now(),now(),now()
        )
      `;
      await tx`
        INSERT INTO companies (id,owner_id,name)
        VALUES (${companyId}::uuid,${userId}::uuid,${`${input.displayName.trim()} Empreendimentos`.slice(0,160)})
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
      const session = await this.createSession(tx, {
        userId,
        email,
        displayName: input.displayName.trim(),
        roles: ["citizen", "company-owner"],
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        deviceName: input.deviceName
      });
      await this.auditInTransaction(tx, {
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
      await tx`
        INSERT INTO idempotency_records (key,actor_id,request_hash,response)
        VALUES (
          ${input.idempotencyKey},${userId}::uuid,
          ${sha256(JSON.stringify({ email, displayName: input.displayName }))},
          ${JSON.stringify(session)}::jsonb
        )
      `;
      return session;
    });
    return result as AuthSessionResult;
  }

  async login(input: {
    email: string;
    password: string;
    ipAddress?: string;
    userAgent?: string;
    deviceName?: string;
  }): Promise<AuthSessionResult> {
    const email = normalizeEmail(input.email);
    const scope = sha256(`${email}:${input.ipAddress ?? "unknown"}`);
    await this.consumeRateLimit({
      scopeKey: scope,
      action: "auth.login",
      limit: 5,
      windowSeconds: 900,
      blockSeconds: 900
    });

    const rows = await this.sql`
      SELECT id,email,display_name,status,
        password_hash=crypt(${input.password},password_hash) valid_password
      FROM users WHERE email=${email}
    `;
    const user = rows[0];
    if (!user || !Boolean(user.valid_password) || String(user.status) !== "active") {
      await this.audit({
        actorUserId: user ? String(user.id) : null,
        subjectUserId: user ? String(user.id) : null,
        action: "auth.login",
        outcome: "denied",
        riskLevel: "medium",
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: { email }
      });
      throw new Error("E-mail ou senha inválidos.");
    }

    const roles = await this.rolesForUser(String(user.id));
    const result = await this.sql.begin(async (tx) => {
      const session = await this.createSession(tx, {
        userId: String(user.id),
        email: String(user.email),
        displayName: String(user.display_name),
        roles,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        deviceName: input.deviceName
      });
      await tx`
        UPDATE users SET last_login_at=now(),updated_at=now()
        WHERE id=${String(user.id)}::uuid
      `;
      await this.auditInTransaction(tx, {
        actorUserId: String(user.id),
        subjectUserId: String(user.id),
        sessionId: session.identity.sessionId,
        action: "auth.login",
        outcome: "success",
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: { deviceName: safeDevice(input.deviceName) }
      });
      await this.upsertPresence(tx, {
        userId: String(user.id),
        sessionId: session.identity.sessionId,
        status: "online",
        locationCode: null,
        metadata: { source: "login" }
      });
      return session;
    });
    return result as AuthSessionResult;
  }

  async authenticateToken(token: string): Promise<AuthenticatedIdentity> {
    const tokenHash = sha256(token);
    const result = await this.sql.begin(async (tx) => {
      const rows = await tx`
        SELECT session.id session_id,session.user_id,session.expires_at,
          user_account.email,user_account.display_name,user_account.status
        FROM auth_sessions session
        JOIN users user_account ON user_account.id=session.user_id
        WHERE session.token_hash=${tokenHash} AND session.status='active'
        FOR UPDATE OF session
      `;
      const session = rows[0];
      if (!session
        || String(session.status ?? "active") !== "active"
        || String(session.user_id).length === 0
        || new Date(String(session.expires_at)).getTime() <= Date.now()
        || String(session.status ?? "active") === "disabled") {
        if (session) {
          await tx`
            UPDATE auth_sessions SET status='expired'
            WHERE id=${String(session.session_id)}::uuid AND status='active'
          `;
        }
        throw new Error("Sessão inválida ou expirada.");
      }
      if (String(session.status ?? "active") !== "active") {
        throw new Error("Conta indisponível.");
      }
      const roles = await this.rolesForUserTx(tx, String(session.user_id));
      await tx`
        UPDATE auth_sessions SET last_seen_at=now()
        WHERE id=${String(session.session_id)}::uuid
      `;
      await this.upsertPresence(tx, {
        userId: String(session.user_id),
        sessionId: String(session.session_id),
        status: "online",
        locationCode: null,
        metadata: { source: "authenticated-request" }
      });
      return {
        userId: String(session.user_id),
        email: String(session.email),
        displayName: String(session.display_name),
        sessionId: String(session.session_id),
        roles,
        expiresAt: new Date(String(session.expires_at)).toISOString()
      } satisfies AuthenticatedIdentity;
    });
    return result as AuthenticatedIdentity;
  }

  async rotateSession(input: {
    token: string;
    ipAddress?: string;
    userAgent?: string;
    deviceName?: string;
  }): Promise<AuthSessionResult> {
    const identity = await this.authenticateToken(input.token);
    const oldHash = sha256(input.token);
    const result = await this.sql.begin(async (tx) => {
      const sessions = await tx`
        SELECT id FROM auth_sessions
        WHERE token_hash=${oldHash} AND status='active' FOR UPDATE
      `;
      if (!sessions[0]) throw new Error("Sessão não pode ser renovada.");
      const replacement = await this.createSession(tx, {
        userId: identity.userId,
        email: identity.email,
        displayName: identity.displayName,
        roles: identity.roles,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        deviceName: input.deviceName
      });
      await tx`
        UPDATE auth_sessions SET status='rotated',revoked_at=now(),
          replaced_by_session_id=${replacement.identity.sessionId}::uuid
        WHERE id=${String(sessions[0].id)}::uuid
      `;
      await this.auditInTransaction(tx, {
        actorUserId: identity.userId,
        subjectUserId: identity.userId,
        sessionId: replacement.identity.sessionId,
        action: "auth.session.rotate",
        outcome: "success",
        ipAddress: input.ipAddress,
        userAgent: input.userAgent
      });
      return replacement;
    });
    return result as AuthSessionResult;
  }

  async logout(input: {
    token: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    const tokenHash = sha256(input.token);
    await this.sql.begin(async (tx) => {
      const rows = await tx`
        UPDATE auth_sessions SET status='revoked',revoked_at=now()
        WHERE token_hash=${tokenHash} AND status='active'
        RETURNING id,user_id
      `;
      const session = rows[0];
      if (!session) return;
      await tx`
        UPDATE live_presence SET status='offline',last_heartbeat_at=now()
        WHERE user_id=${String(session.user_id)}::uuid
      `;
      await this.auditInTransaction(tx, {
        actorUserId: String(session.user_id),
        subjectUserId: String(session.user_id),
        sessionId: String(session.id),
        action: "auth.logout",
        outcome: "success",
        ipAddress: input.ipAddress,
        userAgent: input.userAgent
      });
    });
  }

  async assumeContext(input: {
    identity: AuthenticatedIdentity;
    targetEmail: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AuthenticatedIdentity> {
    if (!input.identity.roles.includes("platform-admin")) {
      await this.audit({
        actorUserId: input.identity.userId,
        subjectUserId: null,
        sessionId: input.identity.sessionId,
        action: "auth.context.assume",
        outcome: "denied",
        riskLevel: "high",
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: { targetEmail: normalizeEmail(input.targetEmail) }
      });
      throw new Error("Alternância de contexto não autorizada.");
    }
    const rows = await this.sql`
      SELECT id,email,display_name,status FROM users
      WHERE email=${normalizeEmail(input.targetEmail)}
    `;
    const target = rows[0];
    if (!target || String(target.status) !== "active") {
      throw new Error("Contexto solicitado indisponível.");
    }
    const roles = await this.rolesForUser(String(target.id));
    await this.audit({
      actorUserId: input.identity.userId,
      subjectUserId: String(target.id),
      sessionId: input.identity.sessionId,
      action: "auth.context.assume",
      outcome: "success",
      riskLevel: "medium",
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: { targetEmail: String(target.email) }
    });
    return {
      userId: String(target.id),
      email: String(target.email),
      displayName: String(target.display_name),
      sessionId: input.identity.sessionId,
      roles,
      expiresAt: input.identity.expiresAt
    };
  }

  async heartbeat(input: {
    identity: AuthenticatedIdentity;
    locationCode?: string;
    status?: "online" | "away" | "busy";
  }): Promise<readonly PresenceView[]> {
    await this.sql.begin(async (tx) => {
      await this.upsertPresence(tx, {
        userId: input.identity.userId,
        sessionId: input.identity.sessionId,
        status: input.status ?? "online",
        locationCode: input.locationCode ?? null,
        metadata: { source: "heartbeat" }
      });
    });
    return this.presence();
  }

  async presence(): Promise<readonly PresenceView[]> {
    const rows = await this.sql`
      SELECT presence.user_id,user_account.display_name,presence.location_code,
        CASE WHEN presence.last_heartbeat_at<now()-interval '2 minutes'
          THEN 'offline' ELSE presence.status END status,
        presence.last_heartbeat_at
      FROM live_presence presence
      JOIN users user_account ON user_account.id=presence.user_id
      ORDER BY presence.last_heartbeat_at DESC
      LIMIT 100
    `;
    return rows.map((row) => ({
      userId: String(row.user_id),
      displayName: String(row.display_name),
      locationCode: row.location_code ? String(row.location_code) : null,
      status: String(row.status),
      lastHeartbeatAt: new Date(String(row.last_heartbeat_at)).toISOString()
    }));
  }

  async notifications(userId: string): Promise<readonly NotificationView[]> {
    const rows = await this.sql`
      SELECT id,event_type,title,body,severity,payload,read_at,created_at
      FROM user_notifications WHERE user_id=${userId}::uuid
      ORDER BY created_at DESC LIMIT 100
    `;
    return rows.map((row) => ({
      id: String(row.id),
      eventType: String(row.event_type),
      title: String(row.title),
      body: String(row.body),
      severity: String(row.severity),
      payload: row.payload,
      readAt: row.read_at ? new Date(String(row.read_at)).toISOString() : null,
      createdAt: new Date(String(row.created_at)).toISOString()
    }));
  }

  async markNotificationRead(userId: string, notificationId: string): Promise<void> {
    await this.sql`
      UPDATE user_notifications SET read_at=COALESCE(read_at,now())
      WHERE id=${notificationId}::uuid AND user_id=${userId}::uuid
    `;
  }

  async consumeRateLimit(input: {
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
      const blockedUntil = rows[0]?.blocked_until
        ? new Date(String(rows[0].blocked_until))
        : null;
      if (blockedUntil && blockedUntil.getTime() > now) {
        throw new Error("Muitas tentativas. Aguarde antes de tentar novamente.");
      }
      if (count > input.limit) {
        const until = new Date(now + input.blockSeconds * 1000);
        await tx`
          UPDATE rate_limit_windows SET blocked_until=${until.toISOString()}
          WHERE scope_key=${input.scopeKey} AND action=${input.action}
            AND window_started_at=${windowStart.toISOString()}
        `;
        throw new Error("Muitas tentativas. Aguarde antes de tentar novamente.");
      }
      return {
        remaining: Math.max(0, input.limit - count),
        resetAt: new Date(windowStart.getTime() + windowMs).toISOString()
      };
    });
    return result as Readonly<{ remaining: number; resetAt: string }>;
  }

  async audit(input: {
    actorUserId: string | null;
    subjectUserId: string | null;
    sessionId?: string;
    action: string;
    resourceType?: string;
    resourceId?: string;
    outcome: "success" | "denied" | "failure";
    riskLevel?: "low" | "medium" | "high" | "critical";
    ipAddress?: string;
    userAgent?: string;
    metadata?: unknown;
  }): Promise<void> {
    await this.sql.begin(async (tx) => this.auditInTransaction(tx, input));
  }

  private async createSession(tx: Tx, input: {
    userId: string;
    email: string;
    displayName: string;
    roles: readonly UserRole[];
    ipAddress?: string;
    userAgent?: string;
    deviceName?: string;
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

  private async rolesForUser(userId: string): Promise<readonly UserRole[]> {
    return this.sql.begin(async (tx) => this.rolesForUserTx(tx, userId));
  }

  private async rolesForUserTx(tx: Tx, userId: string): Promise<readonly UserRole[]> {
    const rows = await tx`
      SELECT role FROM user_roles
      WHERE user_id=${userId}::uuid AND (expires_at IS NULL OR expires_at>now())
      ORDER BY role
    `;
    return rows.map((row) => String(row.role) as UserRole);
  }

  private async auditInTransaction(tx: Tx, input: {
    actorUserId: string | null;
    subjectUserId: string | null;
    sessionId?: string;
    action: string;
    resourceType?: string;
    resourceId?: string;
    outcome: "success" | "denied" | "failure";
    riskLevel?: "low" | "medium" | "high" | "critical";
    ipAddress?: string;
    userAgent?: string;
    metadata?: unknown;
  }): Promise<void> {
    await tx`
      INSERT INTO security_audit_log (
        actor_user_id,subject_user_id,session_id,action,resource_type,resource_id,
        outcome,risk_level,ip_hash,user_agent_hash,metadata
      ) VALUES (
        ${input.actorUserId}::uuid,${input.subjectUserId}::uuid,${input.sessionId ?? null}::uuid,
        ${input.action},${input.resourceType ?? null},${input.resourceId ?? null},
        ${input.outcome},${input.riskLevel ?? "low"},
        ${input.ipAddress ? sha256(input.ipAddress) : null},
        ${input.userAgent ? sha256(input.userAgent) : null},
        ${JSON.stringify(input.metadata ?? {})}::jsonb
      )
    `;
  }

  private async upsertPresence(tx: Tx, input: {
    userId: string;
    sessionId: string;
    locationCode: string | null;
    status: "online" | "away" | "busy" | "offline";
    metadata: unknown;
  }): Promise<void> {
    await tx`
      INSERT INTO live_presence (
        user_id,session_id,location_code,status,last_heartbeat_at,metadata
      ) VALUES (
        ${input.userId}::uuid,${input.sessionId}::uuid,${input.locationCode},
        ${input.status},now(),${JSON.stringify(input.metadata)}::jsonb
      )
      ON CONFLICT (user_id) DO UPDATE SET
        session_id=EXCLUDED.session_id,location_code=COALESCE(EXCLUDED.location_code,live_presence.location_code),
        status=EXCLUDED.status,last_heartbeat_at=now(),metadata=EXCLUDED.metadata
    `;
  }
}
