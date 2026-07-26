import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import {
  LiveSecurityService
} from "./live-security.js";
import type {
  AuthenticatedIdentity,
  AuthSessionResult,
  UserRole
} from "./auth-security.js";
import type { Tx } from "./economy-base.js";

export type MfaChallengeResult = Readonly<{
  requiresMfa: true;
  challenge: string;
  expiresAt: string;
}>;

export type SecureLoginResult = AuthSessionResult | MfaChallengeResult;

export type MfaSetupResult = Readonly<{
  secret: string;
  otpauthUri: string;
}>;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function encryptionKey(): string {
  const configured = process.env.DATA_ENCRYPTION_KEY;
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATA_ENCRYPTION_KEY deve possuir pelo menos 32 caracteres.");
  }
  return "nova-aurora-development-encryption-key-only";
}

function base32Encode(input: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value: string): Buffer {
  const normalized = value.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error("Segredo TOTP inválido.");
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function totp(secret: string, time = Date.now()): string {
  const counter = Math.floor(time / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 15;
  const binary = ((digest[offset]! & 127) << 24)
    | ((digest[offset + 1]! & 255) << 16)
    | ((digest[offset + 2]! & 255) << 8)
    | (digest[offset + 3]! & 255);
  return String(binary % 1_000_000).padStart(6, "0");
}

function validTotp(secret: string, code: string): boolean {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  for (const offset of [-30_000, 0, 30_000]) {
    const expected = Buffer.from(totp(secret, Date.now() + offset));
    const supplied = Buffer.from(normalized);
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) return true;
  }
  return false;
}

function recoveryCode(): string {
  const raw = randomBytes(8).toString("hex").toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`;
}

export class StrongIdentityService extends LiveSecurityService {
  async requestPasswordRecovery(input: {
    email: string;
    ipAddress?: string | undefined;
  }): Promise<Readonly<{ accepted: true; token: string | null; expiresAt: string | null }>> {
    const email = normalizeEmail(input.email);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const users = await this.sql`SELECT id,status FROM users WHERE email=${email}`;
    const user = users[0];
    if (user && String(user.status) === "active") {
      await this.sql.begin(async (tx) => {
        await tx`
          UPDATE account_recovery_tokens SET consumed_at=COALESCE(consumed_at,now())
          WHERE user_id=${String(user.id)}::uuid AND consumed_at IS NULL
        `;
        await tx`
          INSERT INTO account_recovery_tokens (
            id,user_id,token_hash,requested_ip_hash,expires_at
          ) VALUES (
            ${randomUUID()}::uuid,${String(user.id)}::uuid,${sha256(token)},
            ${input.ipAddress ? sha256(input.ipAddress) : null},${expiresAt.toISOString()}
          )
        `;
      });
      await this.audit({
        actorUserId: String(user.id),
        subjectUserId: String(user.id),
        action: "auth.recovery.request",
        outcome: "success",
        riskLevel: "medium",
        ipAddress: input.ipAddress
      });
    }
    return {
      accepted: true,
      token: process.env.ALLOW_RECOVERY_TOKEN_RESPONSE === "true" ? token : null,
      expiresAt: process.env.ALLOW_RECOVERY_TOKEN_RESPONSE === "true"
        ? expiresAt.toISOString()
        : null
    };
  }

  async confirmPasswordRecovery(input: {
    token: string;
    newPassword: string;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<void> {
    if (input.newPassword.length < 12) {
      throw new Error("A senha deve possuir pelo menos 12 caracteres.");
    }
    await this.sql.begin("isolation level serializable", async (tx) => {
      const rows = await tx`
        SELECT recovery.id,recovery.user_id
        FROM account_recovery_tokens recovery
        JOIN users user_account ON user_account.id=recovery.user_id
        WHERE recovery.token_hash=${sha256(input.token)}
          AND recovery.consumed_at IS NULL
          AND recovery.expires_at>now()
          AND user_account.status<>'disabled'
        FOR UPDATE OF recovery
      `;
      const recovery = rows[0];
      if (!recovery) throw new Error("Token de recuperação inválido ou expirado.");
      const userId = String(recovery.user_id);
      await tx`
        UPDATE users SET
          password_hash=crypt(${input.newPassword},gen_salt('bf',12)),
          password_updated_at=now(),status='active',updated_at=now()
        WHERE id=${userId}::uuid
      `;
      await tx`
        UPDATE account_recovery_tokens SET consumed_at=now()
        WHERE user_id=${userId}::uuid AND consumed_at IS NULL
      `;
      await tx`
        UPDATE auth_sessions SET status='revoked',revoked_at=now()
        WHERE user_id=${userId}::uuid AND status='active'
      `;
      await tx`
        INSERT INTO security_audit_log (
          actor_user_id,subject_user_id,action,outcome,risk_level,
          ip_hash,user_agent_hash,metadata
        ) VALUES (
          ${userId}::uuid,${userId}::uuid,'auth.recovery.complete','success','high',
          ${input.ipAddress ? sha256(input.ipAddress) : null},
          ${input.userAgent ? sha256(input.userAgent) : null},
          '{"sessionsRevoked":true}'::jsonb
        )
      `;
    });
  }

  async loginSecure(input: {
    email: string;
    password: string;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
    deviceName?: string | undefined;
  }): Promise<SecureLoginResult> {
    const email = normalizeEmail(input.email);
    const mfaRows = await this.sql`
      SELECT user_account.id,user_account.email,user_account.display_name,user_account.status,
        user_account.password_hash=crypt(${input.password},user_account.password_hash) valid_password,
        user_account.mfa_enabled,mfa.confirmed_at
      FROM users user_account
      LEFT JOIN user_mfa mfa ON mfa.user_id=user_account.id
      WHERE user_account.email=${email}
    `;
    const candidate = mfaRows[0];
    if (!candidate || !Boolean(candidate.mfa_enabled) || !candidate.confirmed_at) {
      return this.login(input);
    }

    const scope = sha256(`${email}:${input.ipAddress ?? "unknown"}`);
    await this.consumeRateLimit({
      scopeKey: scope,
      action: "auth.login.mfa",
      limit: 5,
      windowSeconds: 900,
      blockSeconds: 900
    });
    if (!Boolean(candidate.valid_password) || String(candidate.status) !== "active") {
      await this.audit({
        actorUserId: String(candidate.id),
        subjectUserId: String(candidate.id),
        action: "auth.login",
        outcome: "denied",
        riskLevel: "medium",
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: { mfaExpected: true }
      });
      throw new Error("E-mail ou senha inválidos.");
    }

    const challenge = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await this.sql`
      INSERT INTO mfa_login_challenges (
        id,user_id,challenge_hash,ip_hash,user_agent_hash,device_name,expires_at
      ) VALUES (
        ${randomUUID()}::uuid,${String(candidate.id)}::uuid,${sha256(challenge)},
        ${input.ipAddress ? sha256(input.ipAddress) : null},
        ${input.userAgent ? sha256(input.userAgent) : null},
        ${input.deviceName?.slice(0,120) ?? null},${expiresAt.toISOString()}
      )
    `;
    await this.audit({
      actorUserId: String(candidate.id),
      subjectUserId: String(candidate.id),
      action: "auth.login.mfa-challenge",
      outcome: "success",
      riskLevel: "low",
      ipAddress: input.ipAddress,
      userAgent: input.userAgent
    });
    return { requiresMfa: true, challenge, expiresAt: expiresAt.toISOString() };
  }

  async completeMfaLogin(input: {
    challenge: string;
    code: string;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
    deviceName?: string | undefined;
  }): Promise<AuthSessionResult> {
    const result = await this.sql.begin("isolation level serializable", async (tx) => {
      const rows = await tx`
        SELECT challenge.id challenge_id,challenge.user_id,challenge.expires_at,
          user_account.email,user_account.display_name,user_account.status,
          pgp_sym_decrypt(mfa.secret_ciphertext,${encryptionKey()}) secret
        FROM mfa_login_challenges challenge
        JOIN users user_account ON user_account.id=challenge.user_id
        JOIN user_mfa mfa ON mfa.user_id=challenge.user_id AND mfa.confirmed_at IS NOT NULL
        WHERE challenge.challenge_hash=${sha256(input.challenge)}
          AND challenge.consumed_at IS NULL
        FOR UPDATE OF challenge
      `;
      const row = rows[0];
      if (!row
        || String(row.status) !== "active"
        || new Date(String(row.expires_at)).getTime() <= Date.now()) {
        throw new Error("Desafio de autenticação inválido ou expirado.");
      }
      const userId = String(row.user_id);
      const secret = String(row.secret);
      const factorValid = validTotp(secret, input.code)
        || await this.consumeRecoveryCode(tx, userId, input.code);
      if (!factorValid) throw new Error("Código de autenticação inválido.");

      await tx`
        UPDATE mfa_login_challenges SET consumed_at=now()
        WHERE id=${String(row.challenge_id)}::uuid
      `;
      const roles = await this.rolesFor(tx, userId);
      const session = await this.createSession(tx, {
        userId,
        email: String(row.email),
        displayName: String(row.display_name),
        roles,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        deviceName: input.deviceName
      });
      await tx`
        UPDATE users SET last_login_at=now(),updated_at=now() WHERE id=${userId}::uuid
      `;
      await tx`
        INSERT INTO security_audit_log (
          actor_user_id,subject_user_id,session_id,action,outcome,risk_level,
          ip_hash,user_agent_hash,metadata
        ) VALUES (
          ${userId}::uuid,${userId}::uuid,${session.identity.sessionId}::uuid,
          'auth.login.mfa','success','low',
          ${input.ipAddress ? sha256(input.ipAddress) : null},
          ${input.userAgent ? sha256(input.userAgent) : null},
          '{"secondFactor":true}'::jsonb
        )
      `;
      return session;
    });
    return result as AuthSessionResult;
  }

  async startMfaSetup(identity: AuthenticatedIdentity): Promise<MfaSetupResult> {
    const secret = base32Encode(randomBytes(20));
    await this.sql`
      INSERT INTO user_mfa (user_id,secret_ciphertext,confirmed_at,updated_at)
      VALUES (
        ${identity.userId}::uuid,
        pgp_sym_encrypt(${secret},${encryptionKey()},'cipher-algo=aes256'),
        NULL,now()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        secret_ciphertext=EXCLUDED.secret_ciphertext,confirmed_at=NULL,updated_at=now()
    `;
    await this.sql`
      DELETE FROM mfa_recovery_codes WHERE user_id=${identity.userId}::uuid
    `;
    const issuer = encodeURIComponent("Nova Aurora · Tehkné Solutions");
    const label = encodeURIComponent(`Nova Aurora:${identity.email}`);
    return {
      secret,
      otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`
    };
  }

  async confirmMfaSetup(
    identity: AuthenticatedIdentity,
    code: string
  ): Promise<Readonly<{ recoveryCodes: readonly string[] }>> {
    const rows = await this.sql`
      SELECT pgp_sym_decrypt(secret_ciphertext,${encryptionKey()}) secret
      FROM user_mfa WHERE user_id=${identity.userId}::uuid
    `;
    if (!rows[0] || !validTotp(String(rows[0].secret), code)) {
      throw new Error("Código TOTP inválido.");
    }
    const codes = Array.from({ length: 10 }, recoveryCode);
    await this.sql.begin(async (tx) => {
      await tx`DELETE FROM mfa_recovery_codes WHERE user_id=${identity.userId}::uuid`;
      for (const recovery of codes) {
        await tx`
          INSERT INTO mfa_recovery_codes (id,user_id,code_hash)
          VALUES (${randomUUID()}::uuid,${identity.userId}::uuid,${sha256(recovery)})
        `;
      }
      await tx`
        UPDATE user_mfa SET confirmed_at=now(),updated_at=now()
        WHERE user_id=${identity.userId}::uuid
      `;
      await tx`
        UPDATE users SET mfa_enabled=true,mfa_verified_at=now(),updated_at=now()
        WHERE id=${identity.userId}::uuid
      `;
    });
    await this.audit({
      actorUserId: identity.userId,
      subjectUserId: identity.userId,
      sessionId: identity.sessionId,
      action: "auth.mfa.enable",
      outcome: "success",
      riskLevel: "low"
    });
    return { recoveryCodes: codes };
  }

  async disableMfa(input: {
    identity: AuthenticatedIdentity;
    password: string;
    code: string;
  }): Promise<void> {
    const rows = await this.sql`
      SELECT user_account.password_hash=crypt(${input.password},user_account.password_hash) valid_password,
        pgp_sym_decrypt(mfa.secret_ciphertext,${encryptionKey()}) secret
      FROM users user_account
      JOIN user_mfa mfa ON mfa.user_id=user_account.id AND mfa.confirmed_at IS NOT NULL
      WHERE user_account.id=${input.identity.userId}::uuid
    `;
    const row = rows[0];
    if (!row || !Boolean(row.valid_password)) throw new Error("Credenciais inválidas.");
    const factorValid = validTotp(String(row.secret), input.code)
      || await this.consumeRecoveryCodeDirect(input.identity.userId, input.code);
    if (!factorValid) throw new Error("Segundo fator inválido.");
    await this.sql.begin(async (tx) => {
      await tx`DELETE FROM user_mfa WHERE user_id=${input.identity.userId}::uuid`;
      await tx`DELETE FROM mfa_recovery_codes WHERE user_id=${input.identity.userId}::uuid`;
      await tx`
        UPDATE users SET mfa_enabled=false,mfa_verified_at=NULL,updated_at=now()
        WHERE id=${input.identity.userId}::uuid
      `;
    });
    await this.audit({
      actorUserId: input.identity.userId,
      subjectUserId: input.identity.userId,
      sessionId: input.identity.sessionId,
      action: "auth.mfa.disable",
      outcome: "success",
      riskLevel: "medium"
    });
  }

  private async createSession(tx: Tx, input: {
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
        ${input.deviceName?.slice(0,120) ?? null},${expiresAt.toISOString()}
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

  private async consumeRecoveryCode(tx: Tx, userId: string, code: string): Promise<boolean> {
    const rows = await tx`
      UPDATE mfa_recovery_codes SET used_at=now()
      WHERE user_id=${userId}::uuid AND code_hash=${sha256(code.toUpperCase())} AND used_at IS NULL
      RETURNING id
    `;
    return Boolean(rows[0]);
  }

  private async consumeRecoveryCodeDirect(userId: string, code: string): Promise<boolean> {
    const rows = await this.sql`
      UPDATE mfa_recovery_codes SET used_at=now()
      WHERE user_id=${userId}::uuid AND code_hash=${sha256(code.toUpperCase())} AND used_at IS NULL
      RETURNING id
    `;
    return Boolean(rows[0]);
  }
}
