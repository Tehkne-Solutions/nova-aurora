import { randomUUID } from "node:crypto";
import { dataEncryptionKey } from "./data-protection.js";
import { EconomyRepositoryBase, type Tx } from "./economy-base.js";
import type { AuthenticatedIdentity } from "./auth-security.js";
import {
  evaluateModerationReadiness,
  type ModerationReadiness
} from "./moderation-operations-rules.js";

export type ModerationActionView = Readonly<{
  id: string;
  actionKey: string;
  reportId: string | null;
  subjectUserId: string | null;
  subjectReference: string | null;
  actionType: string;
  reason: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
  createdAt: string;
}>;

export type ModerationAppealView = Readonly<{
  id: string;
  appealKey: string;
  actionId: string;
  appellantUserId: string;
  statement: string;
  status: string;
  reviewerId: string | null;
  decisionNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}>;

export type ModerationShiftView = Readonly<{
  id: string;
  moderatorId: string;
  startsAt: string;
  endsAt: string;
  status: string;
  notes: string | null;
}>;

function iso(value: unknown): string | null {
  return value ? new Date(String(value)).toISOString() : null;
}

export class ModerationOperationsService extends EconomyRepositoryBase {
  async assignReport(input: {
    actorId: string;
    reportId: string;
    moderatorId: string;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      const report = await tx`
        SELECT id FROM trust_reports
        WHERE id=${input.reportId}::uuid
          AND status NOT IN ('closed','dismissed')
        FOR UPDATE
      `;
      if (!report[0]) throw new Error("Denúncia não encontrada ou já encerrada.");
      await tx`
        INSERT INTO moderation_assignments (
          report_id,assigned_to,assigned_by
        ) VALUES (
          ${input.reportId}::uuid,${input.moderatorId}::uuid,${input.actorId}::uuid
        )
        ON CONFLICT (report_id) DO UPDATE SET
          assigned_to=excluded.assigned_to,
          assigned_by=excluded.assigned_by,
          assigned_at=now(),
          acknowledged_at=NULL,
          released_at=NULL,
          release_reason=NULL
      `;
      await tx`
        UPDATE trust_reports SET
          assigned_to=${input.moderatorId}::uuid,
          status=CASE WHEN status='open' THEN 'triaged' ELSE status END,
          updated_at=now()
        WHERE id=${input.reportId}::uuid
      `;
      await this.reportUpdate(tx, input.reportId, "triaged",
        "Denúncia atribuída para análise.", "assignment", input.actorId);
    });
    await this.syncGate(input.actorId);
  }

  async acknowledgeReport(input: {
    actorId: string;
    reportId: string;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      const rows = await tx`
        UPDATE moderation_assignments SET acknowledged_at=COALESCE(acknowledged_at,now())
        WHERE report_id=${input.reportId}::uuid
          AND assigned_to=${input.actorId}::uuid
          AND released_at IS NULL
        RETURNING report_id
      `;
      if (!rows[0]) throw new Error("Atribuição não encontrada para este moderador.");
      await tx`
        UPDATE trust_reports SET
          acknowledged_at=COALESCE(acknowledged_at,now()),
          status='investigating',updated_at=now()
        WHERE id=${input.reportId}::uuid
      `;
      await this.reportUpdate(tx, input.reportId, "investigating",
        "Atendimento do caso iniciado.", "acknowledged", input.actorId);
    });
    await this.syncGate(input.actorId);
  }

  async applyAction(input: {
    actorId: string;
    reportId?: string | undefined;
    subjectUserId?: string | undefined;
    subjectReference?: string | undefined;
    actionType: "warning" | "restrict-economy" | "suspend-account" | "remove-content" | "no-action";
    reason: string;
    endsAt?: string | undefined;
    idempotencyKey: string;
  }): Promise<ModerationActionView> {
    return this.idempotent(
      `moderation-action:${input.idempotencyKey}`,
      input.actorId,
      input,
      async (tx) => {
        if (!input.reportId && !input.subjectUserId && !input.subjectReference) {
          throw new Error("Informe o caso ou o objeto sujeito à ação.");
        }
        const id = randomUUID();
        const actionKey = `MOD-${new Date().getUTCFullYear()}-${id.slice(0,8).toUpperCase()}`;
        const rows = await tx`
          INSERT INTO moderation_actions (
            id,action_key,report_id,subject_user_id,subject_reference,
            action_type,reason,ends_at,created_by
          ) VALUES (
            ${id}::uuid,${actionKey},${input.reportId ?? null}::uuid,
            ${input.subjectUserId ?? null}::uuid,${input.subjectReference ?? null},
            ${input.actionType},${input.reason.slice(0,4000)},${input.endsAt ?? null},
            ${input.actorId}::uuid
          )
          RETURNING *
        `;
        if (input.subjectUserId && input.actionType === "suspend-account") {
          await tx`
            UPDATE users SET public_beta_access='suspended',
              beta_activation_state='revoked',
              beta_access_updated_at=now(),beta_activation_updated_at=now(),updated_at=now()
            WHERE id=${input.subjectUserId}::uuid
          `;
        }
        if (input.subjectUserId && input.actionType === "restrict-economy") {
          await tx`
            UPDATE user_risk_profiles SET economic_status='restricted',updated_at=now()
            WHERE user_id=${input.subjectUserId}::uuid
          `;
        }
        if (input.reportId) {
          await tx`
            UPDATE trust_reports SET status='actioned',updated_at=now()
            WHERE id=${input.reportId}::uuid
          `;
          await this.reportUpdate(tx, input.reportId, "actioned",
            input.reason, input.actionType, input.actorId);
        }
        return this.mapAction(rows[0]);
      }
    );
  }

  async submitAppeal(input: {
    identity: AuthenticatedIdentity;
    actionId: string;
    statement: string;
  }): Promise<Readonly<{ appealKey: string; status: string }>> {
    const rows = await this.sql.begin(async (tx) => {
      const action = await tx`
        SELECT id,subject_user_id,status FROM moderation_actions
        WHERE id=${input.actionId}::uuid FOR UPDATE
      `;
      if (!action[0] || String(action[0].subject_user_id ?? "") !== input.identity.userId) {
        throw new Error("Ação de moderação não encontrada para esta conta.");
      }
      if (String(action[0].status) !== "active") {
        throw new Error("Esta ação não admite novo recurso.");
      }
      const id = randomUUID();
      const appealKey = `APL-${new Date().getUTCFullYear()}-${id.slice(0,8).toUpperCase()}`;
      return tx`
        INSERT INTO moderation_appeals (
          id,appeal_key,action_id,appellant_user_id,statement
        ) VALUES (
          ${id}::uuid,${appealKey},${input.actionId}::uuid,${input.identity.userId}::uuid,
          pgp_sym_encrypt(${input.statement.slice(0,8000)},${dataEncryptionKey()},'cipher-algo=aes256')
        )
        ON CONFLICT (action_id,appellant_user_id) DO UPDATE SET
          statement=excluded.statement,
          status=CASE
            WHEN moderation_appeals.status IN ('upheld','denied') THEN moderation_appeals.status
            ELSE 'pending'
          END,
          updated_at=now()
        RETURNING appeal_key,status
      `;
    });
    const row = rows[0];
    if (!row) throw new Error("Recurso não pôde ser registrado.");
    return { appealKey: String(row.appeal_key), status: String(row.status) };
  }

  async reviewAppeal(input: {
    actorId: string;
    appealId: string;
    decision: "upheld" | "denied";
    note: string;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      const rows = await tx`
        UPDATE moderation_appeals SET status=${input.decision},
          reviewer_id=${input.actorId}::uuid,decision_note=${input.note.slice(0,4000)},
          reviewed_at=now(),updated_at=now()
        WHERE id=${input.appealId}::uuid AND status IN ('pending','in-review')
        RETURNING action_id,appellant_user_id
      `;
      const appeal = rows[0];
      if (!appeal) throw new Error("Recurso não encontrado ou já decidido.");
      if (input.decision === "upheld") {
        await tx`
          UPDATE moderation_actions SET status='revoked',updated_at=now()
          WHERE id=${String(appeal.action_id)}::uuid
        `;
        await tx`
          UPDATE users SET
            public_beta_access=CASE
              WHEN status='active' AND email_verified_at IS NOT NULL THEN 'active'
              ELSE public_beta_access
            END,
            beta_activation_state='pending',
            beta_access_updated_at=now(),beta_activation_updated_at=now(),updated_at=now()
          WHERE id=${String(appeal.appellant_user_id)}::uuid
        `;
      }
    });
  }

  async scheduleShift(input: {
    actorId: string;
    moderatorId: string;
    startsAt: string;
    endsAt: string;
    notes?: string | undefined;
  }): Promise<ModerationShiftView> {
    if (new Date(input.endsAt).getTime() <= new Date(input.startsAt).getTime()) {
      throw new Error("O fim do turno deve ocorrer após o início.");
    }
    const rows = await this.sql`
      INSERT INTO moderation_shifts (
        id,moderator_id,starts_at,ends_at,notes,created_by
      ) VALUES (
        ${randomUUID()}::uuid,${input.moderatorId}::uuid,${input.startsAt},${input.endsAt},
        ${input.notes?.slice(0,1000) ?? null},${input.actorId}::uuid
      )
      RETURNING *
    `;
    const shift = this.mapShift(rows[0]);
    await this.syncGate(input.actorId);
    return shift;
  }

  async readiness(): Promise<ModerationReadiness> {
    const [coverage, reports, appeals] = await Promise.all([
      this.sql`
        SELECT count(DISTINCT moderator_id)::int total
        FROM moderation_shifts
        WHERE status IN ('scheduled','active')
          AND starts_at<=now()+interval '24 hours'
          AND ends_at>now()
      `,
      this.sql`
        SELECT
          count(*) FILTER (
            WHERE priority='critical'
              AND status IN ('open','triaged','investigating')
              AND first_response_due_at<now()
              AND acknowledged_at IS NULL
          )::int overdue_critical,
          count(*) FILTER (
            WHERE priority='high'
              AND status IN ('open','triaged','investigating')
              AND first_response_due_at<now()
              AND acknowledged_at IS NULL
          )::int overdue_high
        FROM trust_reports
      `,
      this.sql`
        SELECT count(*)::int total FROM moderation_appeals
        WHERE status IN ('pending','in-review')
      `
    ]);
    return evaluateModerationReadiness({
      activeOrUpcomingModerators: Number(coverage[0]?.total ?? 0),
      overdueCriticalReports: Number(reports[0]?.overdue_critical ?? 0),
      overdueHighReports: Number(reports[0]?.overdue_high ?? 0),
      pendingAppeals: Number(appeals[0]?.total ?? 0)
    });
  }

  async state(): Promise<Readonly<{
    readiness: ModerationReadiness;
    actions: readonly ModerationActionView[];
    appeals: readonly ModerationAppealView[];
    shifts: readonly ModerationShiftView[];
  }>> {
    const [readiness, actions, appeals, shifts] = await Promise.all([
      this.readiness(),
      this.sql`SELECT * FROM moderation_actions ORDER BY created_at DESC LIMIT 300`,
      this.sql`
        SELECT appeal.*,
          pgp_sym_decrypt(appeal.statement,${dataEncryptionKey()}) statement_plaintext
        FROM moderation_appeals appeal ORDER BY created_at DESC LIMIT 300
      `,
      this.sql`SELECT * FROM moderation_shifts ORDER BY starts_at DESC LIMIT 300`
    ]);
    return {
      readiness,
      actions: actions.map((row) => this.mapAction(row)),
      appeals: appeals.map((row) => ({
        id: String(row.id), appealKey: String(row.appeal_key),
        actionId: String(row.action_id), appellantUserId: String(row.appellant_user_id),
        statement: String(row.statement_plaintext), status: String(row.status),
        reviewerId: row.reviewer_id ? String(row.reviewer_id) : null,
        decisionNote: row.decision_note ? String(row.decision_note) : null,
        reviewedAt: iso(row.reviewed_at), createdAt: new Date(String(row.created_at)).toISOString()
      })),
      shifts: shifts.map((row) => this.mapShift(row))
    };
  }

  private async syncGate(actorId: string): Promise<void> {
    const readiness = await this.readiness();
    await this.sql`
      UPDATE release_gate_checks SET status=${readiness.ready ? "passing" : "blocked"},
        evidence=${JSON.stringify(readiness)}::jsonb,
        notes=${readiness.blockers.join(" ").slice(0,2000) || "Cobertura operacional vigente."},
        checked_at=now(),updated_by=${actorId}::uuid,updated_at=now()
      WHERE gate_key='moderation-sla-coverage'
    `;
  }

  private async reportUpdate(
    tx: Tx,
    reportId: string,
    status: string,
    note: string,
    actionCode: string,
    actorId: string
  ): Promise<void> {
    await tx`
      INSERT INTO trust_report_updates (id,report_id,status,note,action_code,created_by)
      VALUES (${randomUUID()}::uuid,${reportId}::uuid,${status},
        ${note.slice(0,4000)},${actionCode},${actorId}::uuid)
    `;
  }

  private mapAction(row: Record<string, unknown> | undefined): ModerationActionView {
    if (!row) throw new Error("Ação de moderação não pôde ser registrada.");
    return {
      id: String(row.id), actionKey: String(row.action_key),
      reportId: row.report_id ? String(row.report_id) : null,
      subjectUserId: row.subject_user_id ? String(row.subject_user_id) : null,
      subjectReference: row.subject_reference ? String(row.subject_reference) : null,
      actionType: String(row.action_type), reason: String(row.reason),
      status: String(row.status), startsAt: new Date(String(row.starts_at)).toISOString(),
      endsAt: iso(row.ends_at), createdAt: new Date(String(row.created_at)).toISOString()
    };
  }

  private mapShift(row: Record<string, unknown> | undefined): ModerationShiftView {
    if (!row) throw new Error("Turno de moderação não pôde ser salvo.");
    return {
      id: String(row.id), moderatorId: String(row.moderator_id),
      startsAt: new Date(String(row.starts_at)).toISOString(),
      endsAt: new Date(String(row.ends_at)).toISOString(),
      status: String(row.status), notes: row.notes ? String(row.notes) : null
    };
  }
}
