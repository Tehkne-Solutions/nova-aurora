import { randomUUID } from "node:crypto";
import { dataEncryptionKey } from "./data-protection.js";
import { EconomyRepositoryBase, type Tx } from "./economy-base.js";
import type { AuthenticatedIdentity } from "./auth-security.js";
import {
  calculateContinuousCoverageMinutes,
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
  async preparePlayerAccess(userId: string): Promise<void> {
    await this.expireActions(userId);
  }

  async assignReport(input: {
    actorId: string;
    reportId: string;
    moderatorId: string;
  }): Promise<void> {
    await this.assertModerator(input.moderatorId);
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
      await this.reportUpdate(
        tx,
        input.reportId,
        "triaged",
        "Denúncia atribuída para análise.",
        "assignment",
        input.actorId
      );
    });
    await this.syncGate(input.actorId);
  }

  async acknowledgeReport(input: {
    actorId: string;
    reportId: string;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      const rows = await tx`
        UPDATE moderation_assignments
        SET acknowledged_at=COALESCE(acknowledged_at,now())
        WHERE report_id=${input.reportId}::uuid
          AND assigned_to=${input.actorId}::uuid
          AND released_at IS NULL
        RETURNING report_id
      `;
      if (!rows[0]) throw new Error("Atribuição não encontrada para este moderador.");
      await tx`
        UPDATE trust_reports SET
          acknowledged_at=COALESCE(acknowledged_at,now()),
          status='investigating',
          updated_at=now()
        WHERE id=${input.reportId}::uuid
      `;
      await this.reportUpdate(
        tx,
        input.reportId,
        "investigating",
        "Atendimento do caso iniciado.",
        "acknowledged",
        input.actorId
      );
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
    if (input.endsAt && new Date(input.endsAt).getTime() <= Date.now()) {
      throw new Error("O término da ação deve estar no futuro.");
    }

    return this.idempotent(
      `moderation-action:${input.idempotencyKey}`,
      input.actorId,
      input,
      async (tx) => {
        if (!input.reportId && !input.subjectUserId && !input.subjectReference) {
          throw new Error("Informe o caso ou o objeto sujeito à ação.");
        }

        let previousBetaAccess: string | null = null;
        let previousActivationState: string | null = null;
        let previousEconomicStatus: string | null = null;
        if (input.subjectUserId) {
          const users = await tx`
            SELECT account.public_beta_access,account.beta_activation_state,
              COALESCE(risk.economic_status,'normal') economic_status
            FROM users account
            LEFT JOIN user_risk_profiles risk ON risk.user_id=account.id
            WHERE account.id=${input.subjectUserId}::uuid
            FOR UPDATE OF account
          `;
          const user = users[0];
          if (!user) throw new Error("Usuário sujeito à ação não encontrado.");
          previousBetaAccess = String(user.public_beta_access);
          previousActivationState = String(user.beta_activation_state);
          previousEconomicStatus = String(user.economic_status);
        }

        const id = randomUUID();
        const actionKey = `MOD-${new Date().getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}`;
        const rows = await tx`
          INSERT INTO moderation_actions (
            id,action_key,report_id,subject_user_id,subject_reference,
            action_type,reason,ends_at,previous_beta_access,
            previous_beta_activation_state,previous_economic_status,created_by
          ) VALUES (
            ${id}::uuid,${actionKey},${input.reportId ?? null}::uuid,
            ${input.subjectUserId ?? null}::uuid,${input.subjectReference ?? null},
            ${input.actionType},${input.reason.slice(0,4000)},${input.endsAt ?? null},
            ${previousBetaAccess},${previousActivationState},${previousEconomicStatus},
            ${input.actorId}::uuid
          )
          RETURNING *
        `;

        if (input.subjectUserId && input.actionType === "suspend-account") {
          await tx`
            UPDATE users SET
              public_beta_access='suspended',
              beta_activation_state='revoked',
              beta_access_updated_at=now(),
              beta_activation_updated_at=now(),
              updated_at=now()
            WHERE id=${input.subjectUserId}::uuid
          `;
        }

        if (input.subjectUserId && input.actionType === "restrict-economy") {
          await tx`
            INSERT INTO user_risk_profiles (
              user_id,risk_score,risk_level,economic_status,review_reason
            ) VALUES (
              ${input.subjectUserId}::uuid,0,'low','restricted','moderation-action'
            )
            ON CONFLICT (user_id) DO UPDATE SET
              economic_status='restricted',
              review_reason='moderation-action',
              last_evaluated_at=now(),
              updated_at=now()
          `;
        }

        if (input.reportId) {
          await tx`
            UPDATE trust_reports SET status='actioned',updated_at=now()
            WHERE id=${input.reportId}::uuid
          `;
          await this.reportUpdate(
            tx,
            input.reportId,
            "actioned",
            input.reason,
            input.actionType,
            input.actorId
          );
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

      const old = await tx`
        SELECT appeal_key,status FROM moderation_appeals
        WHERE action_id=${input.actionId}::uuid
          AND appellant_user_id=${input.identity.userId}::uuid
        FOR UPDATE
      `;
      if (old[0] && !["pending", "in-review"].includes(String(old[0].status))) {
        throw new Error("O recurso já foi decidido e sua evidência é imutável.");
      }

      if (old[0]) {
        return tx`
          UPDATE moderation_appeals SET
            statement=pgp_sym_encrypt(
              ${input.statement.slice(0,8000)},
              ${dataEncryptionKey()},
              'cipher-algo=aes256'
            ),
            updated_at=now()
          WHERE action_id=${input.actionId}::uuid
            AND appellant_user_id=${input.identity.userId}::uuid
            AND status IN ('pending','in-review')
          RETURNING appeal_key,status
        `;
      }

      const id = randomUUID();
      const appealKey = `APL-${new Date().getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}`;
      return tx`
        INSERT INTO moderation_appeals (
          id,appeal_key,action_id,appellant_user_id,statement
        ) VALUES (
          ${id}::uuid,${appealKey},${input.actionId}::uuid,${input.identity.userId}::uuid,
          pgp_sym_encrypt(
            ${input.statement.slice(0,8000)},
            ${dataEncryptionKey()},
            'cipher-algo=aes256'
          )
        )
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
      const appeals = await tx`
        SELECT appeal.id,appeal.action_id,appeal.appellant_user_id,
          action.created_by,action.action_type,action.status action_status
        FROM moderation_appeals appeal
        JOIN moderation_actions action ON action.id=appeal.action_id
        WHERE appeal.id=${input.appealId}::uuid
          AND appeal.status IN ('pending','in-review')
        FOR UPDATE OF appeal,action
      `;
      const appeal = appeals[0];
      if (!appeal) throw new Error("Recurso não encontrado ou já decidido.");
      if (String(appeal.created_by) === input.actorId) {
        throw new Error("O recurso deve ser decidido por revisor independente da ação.");
      }

      await tx`
        UPDATE moderation_appeals SET
          status=${input.decision},
          reviewer_id=${input.actorId}::uuid,
          decision_note=${input.note.slice(0,4000)},
          reviewed_at=now(),
          updated_at=now()
        WHERE id=${input.appealId}::uuid
      `;

      if (input.decision === "upheld") {
        await this.restoreActionTx(tx, String(appeal.action_id), "revoked");
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
    await this.assertModerator(input.moderatorId);
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
    await this.expireActions();
    const windowStart = new Date();
    const windowEnd = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);
    const [shifts, reports, appeals] = await Promise.all([
      this.sql`
        SELECT shift.moderator_id,shift.starts_at,shift.ends_at
        FROM moderation_shifts shift
        JOIN users account ON account.id=shift.moderator_id AND account.status='active'
        JOIN user_roles role ON role.user_id=account.id
          AND role.role IN ('platform-admin','municipal-admin')
        WHERE shift.status IN ('scheduled','active')
          AND shift.starts_at<${windowEnd.toISOString()}
          AND shift.ends_at>${windowStart.toISOString()}
        ORDER BY shift.starts_at
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

    const coveredMinutes = calculateContinuousCoverageMinutes(
      shifts.map((row) => ({
        startsAt: new Date(String(row.starts_at)).toISOString(),
        endsAt: new Date(String(row.ends_at)).toISOString()
      })),
      windowStart,
      windowEnd
    );

    return evaluateModerationReadiness({
      coveredMinutes,
      activeOrUpcomingModerators: new Set(
        shifts.map((row) => String(row.moderator_id))
      ).size,
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
    await this.expireActions();
    const [readiness, actions, appeals, shifts] = await Promise.all([
      this.readiness(),
      this.sql`SELECT * FROM moderation_actions ORDER BY created_at DESC LIMIT 300`,
      this.sql`
        SELECT appeal.*,
          pgp_sym_decrypt(appeal.statement,${dataEncryptionKey()}) statement_plaintext
        FROM moderation_appeals appeal
        ORDER BY created_at DESC
        LIMIT 300
      `,
      this.sql`SELECT * FROM moderation_shifts ORDER BY starts_at DESC LIMIT 300`
    ]);
    return {
      readiness,
      actions: actions.map((row) => this.mapAction(row)),
      appeals: appeals.map((row) => ({
        id: String(row.id),
        appealKey: String(row.appeal_key),
        actionId: String(row.action_id),
        appellantUserId: String(row.appellant_user_id),
        statement: String(row.statement_plaintext),
        status: String(row.status),
        reviewerId: row.reviewer_id ? String(row.reviewer_id) : null,
        decisionNote: row.decision_note ? String(row.decision_note) : null,
        reviewedAt: iso(row.reviewed_at),
        createdAt: new Date(String(row.created_at)).toISOString()
      })),
      shifts: shifts.map((row) => this.mapShift(row))
    };
  }

  private async assertModerator(userId: string): Promise<void> {
    const rows = await this.sql`
      SELECT account.id
      FROM users account
      JOIN user_roles role ON role.user_id=account.id
      WHERE account.id=${userId}::uuid
        AND account.status='active'
        AND role.role IN ('platform-admin','municipal-admin')
      LIMIT 1
    `;
    if (!rows[0]) {
      throw new Error("A cobertura exige moderador com papel administrativo ativo.");
    }
  }

  private async expireActions(userId?: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      const rows = userId
        ? await tx`
            SELECT id FROM moderation_actions
            WHERE status='active'
              AND ends_at IS NOT NULL
              AND ends_at<=now()
              AND subject_user_id=${userId}::uuid
            ORDER BY ends_at,id
            FOR UPDATE
          `
        : await tx`
            SELECT id FROM moderation_actions
            WHERE status='active'
              AND ends_at IS NOT NULL
              AND ends_at<=now()
            ORDER BY ends_at,id
            FOR UPDATE
          `;

      for (const row of rows) {
        await this.restoreActionTx(tx, String(row.id), "expired");
      }
    });
  }

  private async restoreActionTx(
    tx: Tx,
    actionId: string,
    nextStatus: "revoked" | "expired"
  ): Promise<void> {
    const actions = await tx`
      SELECT * FROM moderation_actions
      WHERE id=${actionId}::uuid
      FOR UPDATE
    `;
    const action = actions[0];
    if (!action || String(action.status) !== "active") return;

    await tx`
      UPDATE moderation_actions SET status=${nextStatus},updated_at=now()
      WHERE id=${actionId}::uuid
    `;

    if (!action.subject_user_id) return;
    const userId = String(action.subject_user_id);
    const actionType = String(action.action_type);

    const other = await tx`
      SELECT count(*)::int total FROM moderation_actions
      WHERE subject_user_id=${userId}::uuid
        AND action_type=${actionType}
        AND status='active'
        AND id<>${actionId}::uuid
        AND (ends_at IS NULL OR ends_at>now())
    `;
    if (Number(other[0]?.total ?? 0) > 0) return;

    if (actionType === "suspend-account") {
      await tx`
        UPDATE users SET
          public_beta_access=COALESCE(${action.previous_beta_access},public_beta_access),
          beta_activation_state=COALESCE(
            ${action.previous_beta_activation_state},
            beta_activation_state
          ),
          beta_access_updated_at=now(),
          beta_activation_updated_at=now(),
          updated_at=now()
        WHERE id=${userId}::uuid
      `;
    }

    if (actionType === "restrict-economy") {
      await tx`
        INSERT INTO user_risk_profiles (
          user_id,risk_score,risk_level,economic_status,review_reason
        ) VALUES (
          ${userId}::uuid,0,'low',
          COALESCE(${action.previous_economic_status},'normal'),
          ${nextStatus === "revoked" ? "appeal-upheld" : "moderation-action-expired"}
        )
        ON CONFLICT (user_id) DO UPDATE SET
          economic_status=excluded.economic_status,
          review_reason=excluded.review_reason,
          last_evaluated_at=now(),
          updated_at=now()
      `;
    }
  }

  private async syncGate(actorId: string): Promise<void> {
    const readiness = await this.readiness();
    await this.sql`
      UPDATE release_gate_checks SET
        status=${readiness.ready ? "passing" : "blocked"},
        evidence=${JSON.stringify(readiness)}::jsonb,
        notes=${
          readiness.blockers.join(" ").slice(0,2000)
          || "Cobertura operacional contínua vigente."
        },
        checked_at=now(),
        updated_by=${actorId}::uuid,
        updated_at=now()
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
      INSERT INTO trust_report_updates (
        id,report_id,status,note,action_code,created_by
      ) VALUES (
        ${randomUUID()}::uuid,
        ${reportId}::uuid,
        ${status},
        ${note.slice(0,4000)},
        ${actionCode},
        ${actorId}::uuid
      )
    `;
  }

  private mapAction(
    row: Record<string, unknown> | undefined
  ): ModerationActionView {
    if (!row) throw new Error("Ação de moderação não pôde ser registrada.");
    return {
      id: String(row.id),
      actionKey: String(row.action_key),
      reportId: row.report_id ? String(row.report_id) : null,
      subjectUserId: row.subject_user_id ? String(row.subject_user_id) : null,
      subjectReference: row.subject_reference
        ? String(row.subject_reference)
        : null,
      actionType: String(row.action_type),
      reason: String(row.reason),
      status: String(row.status),
      startsAt: new Date(String(row.starts_at)).toISOString(),
      endsAt: iso(row.ends_at),
      createdAt: new Date(String(row.created_at)).toISOString()
    };
  }

  private mapShift(
    row: Record<string, unknown> | undefined
  ): ModerationShiftView {
    if (!row) throw new Error("Turno de moderação não pôde ser salvo.");
    return {
      id: String(row.id),
      moderatorId: String(row.moderator_id),
      startsAt: new Date(String(row.starts_at)).toISOString(),
      endsAt: new Date(String(row.ends_at)).toISOString(),
      status: String(row.status),
      notes: row.notes ? String(row.notes) : null
    };
  }
}
