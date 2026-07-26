import { createHash, randomBytes, randomUUID } from "node:crypto";
import { EconomyRepositoryBase } from "./economy-base.js";
import { enqueueTransactionalEmail } from "./transactional-email.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function publicWebUrl(): string {
  const value = process.env.PUBLIC_WEB_URL?.trim();
  if (value) return value.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") throw new Error("PUBLIC_WEB_URL não configurada.");
  return "http://localhost:3000";
}

export class AccountDeliveryService extends EconomyRepositoryBase {
  async requestPasswordRecovery(input: {
    email: string;
    ipAddress?: string | undefined;
  }): Promise<Readonly<{ accepted: true; token: string | null; expiresAt: string | null }>> {
    const email = normalizeEmail(input.email);
    const token = randomBytes(32).toString("base64url");
    const tokenId = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const users = await this.sql`SELECT id,status FROM users WHERE email=${email}`;
    const user = users[0];
    if (user && String(user.status) === "active") {
      const userId = String(user.id);
      await this.sql.begin(async (tx) => {
        await tx`
          UPDATE account_recovery_tokens SET consumed_at=COALESCE(consumed_at,now())
          WHERE user_id=${userId}::uuid AND consumed_at IS NULL
        `;
        await tx`
          INSERT INTO account_recovery_tokens (
            id,user_id,token_hash,requested_ip_hash,expires_at
          ) VALUES (
            ${tokenId}::uuid,${userId}::uuid,${sha256(token)},
            ${input.ipAddress ? sha256(input.ipAddress) : null},${expiresAt.toISOString()}
          )
        `;
        await enqueueTransactionalEmail(tx, {
          deliveryKey: `recover-account:${tokenId}`,
          userId,
          recipient: email,
          template: "recover-account",
          subject: "Recupere sua conta Nova Aurora",
          payload: {
            recoveryUrl: `${publicWebUrl()}/recover-account?token=${encodeURIComponent(token)}`,
            expiresAt: expiresAt.toISOString(),
            signature: "Tehkné Solutions"
          }
        });
        await tx`
          INSERT INTO security_audit_log (
            actor_user_id,subject_user_id,action,outcome,risk_level,ip_hash,metadata
          ) VALUES (
            ${userId}::uuid,${userId}::uuid,'auth.recovery.request','success','medium',
            ${input.ipAddress ? sha256(input.ipAddress) : null},
            '{"deliveredExternally":true}'::jsonb
          )
        `;
      });
    }
    const expose = process.env.ALLOW_RECOVERY_TOKEN_RESPONSE === "true";
    return {
      accepted: true,
      token: expose ? token : null,
      expiresAt: expose ? expiresAt.toISOString() : null
    };
  }
}
