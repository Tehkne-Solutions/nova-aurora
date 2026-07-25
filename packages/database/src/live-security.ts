import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AuthSecurityService, type AuthenticatedIdentity, type UserRole } from "./auth-security.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class LiveSecurityService extends AuthSecurityService {
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
      const roleRows = await tx`
        SELECT role FROM user_roles
        WHERE user_id=${String(row.user_id)}::uuid
          AND (expires_at IS NULL OR expires_at>now())
        ORDER BY role
      `;
      return {
        userId: String(row.user_id),
        email: String(row.email),
        displayName: String(row.display_name),
        sessionId: String(row.session_id),
        roles: roleRows.map((role) => String(role.role) as UserRole),
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
}
