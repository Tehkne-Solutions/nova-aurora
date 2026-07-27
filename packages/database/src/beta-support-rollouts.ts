import { randomUUID } from "node:crypto";
import { dataEncryptionKey } from "./data-protection.js";
import { EconomyRepositoryBase, type Tx } from "./economy-base.js";
import {
  approvalDerivedStatus,
  deterministicFeatureDecision,
  evaluateSupportRolloutReadiness,
  supportDeadlines,
  type FeatureFlagStatus,
  type SupportPriority,
  type SupportRolloutReadiness,
  type SupportTicketStatus
} from "./beta-support-rollout-rules.js";

export type SupportUpdateView = Readonly<{
  id: string;
  status: SupportTicketStatus;
  message: string;
  visibleToUser: boolean;
  authorUserId: string;
  createdAt: string;
}>;

export type SupportTicketView = Readonly<{
  id: string;
  ticketKey: string;
  userId: string;
  waveId: string | null;
  category: string;
  priority: SupportPriority;
  subject: string;
  details: string;
  status: SupportTicketStatus;
  assignedTo: string | null;
  firstResponseDueAt: string;
  resolutionDueAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  updates: readonly SupportUpdateView[];
}>;

export type FeatureFlagView = Readonly<{
  id: string;
  flagKey: string;
  label: string;
  description: string;
  status: FeatureFlagStatus;
  defaultVariant: string;
  variants: readonly string[];
  rolloutPercent: number;
  targetWaveIds: readonly string[];
  safetyThresholds: unknown;
  approvals: number;
  rejections: number;
  createdBy: string;
  updatedBy: string;
  activatedAt: string | null;
  pausedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type FeatureEvaluation = Readonly<{
  flagKey: string;
  enabled: boolean;
  variant: string;
  bucket: number;
  waveId: string | null;
  exposedAt: string | null;
}>;

function iso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function optionalIso(value: unknown): string | null {
  return value ? iso(value) : null;
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String);
}

export class BetaSupportRolloutService extends EconomyRepositoryBase {
  async createTicket(input: {
    userId: string;
    idempotencyKey: string;
    category: "account" | "technical" | "gameplay" | "economy" | "safety" | "privacy" | "other";
    priority: SupportPriority;
    subject: string;
    details: string;
  }): Promise<SupportTicketView> {
    const result = await this.idempotent(
      `beta-support-ticket:${input.userId}:${input.idempotencyKey}`,
      input.userId,
      input,
      async (tx) => {
        const createdAt = new Date();
        const deadlines = supportDeadlines(input.priority, createdAt);
        const waves = await tx`
          SELECT member.wave_id
          FROM beta_wave_members member
          JOIN beta_rollout_waves wave ON wave.id=member.wave_id
          WHERE member.user_id=${input.userId}::uuid
            AND member.status IN ('active','paused','completed')
          ORDER BY wave.activated_at DESC NULLS LAST,wave.created_at DESC
          LIMIT 1
        `;
        const id = randomUUID();
        const ticketKey = `SUP-${createdAt.getUTCFullYear()}-${id.slice(0,8).toUpperCase()}`;
        const rows = await tx`
          INSERT INTO beta_support_tickets (
            id,ticket_key,submission_key,user_id,wave_id,category,priority,
            subject,details,first_response_due_at,resolution_due_at,created_at,updated_at
          ) VALUES (
            ${id}::uuid,${ticketKey},${input.idempotencyKey},${input.userId}::uuid,
            ${waves[0]?.wave_id ? String(waves[0].wave_id) : null}::uuid,
            ${input.category},${input.priority},${input.subject.slice(0,240)},
            pgp_sym_encrypt(
              ${input.details.slice(0,12000)},${dataEncryptionKey()},'cipher-algo=aes256'
            ),
            ${deadlines.firstResponseDueAt},${deadlines.resolutionDueAt},
            ${createdAt.toISOString()},${createdAt.toISOString()}
          ) RETURNING *
        `;
        await this.outbox(tx,id,"beta.support.ticket.created",{
          ticketKey,
          category: input.category,
          priority: input.priority,
          waveId: waves[0]?.wave_id ?? null
        });
        return this.mapTicket(rows[0],input.details,[]);
      }
    );
    await this.syncGates(input.userId);
    return result;
  }

  async updateTicket(input: {
    actorId: string;
    ticketId: string;
    status: SupportTicketStatus;
    priority: SupportPriority;
    message: string;
    visibleToUser: boolean;
    assignedTo?: string | undefined;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      await this.assertAdministrativeActor(tx,input.actorId,[
        "platform-admin","municipal-admin"
      ]);
      if (input.assignedTo) {
        await this.assertAdministrativeActor(tx,input.assignedTo,[
          "platform-admin","municipal-admin"
        ]);
      }
      const ticketRows = await tx`
        SELECT id,created_at,status FROM beta_support_tickets
        WHERE id=${input.ticketId}::uuid FOR UPDATE
      `;
      const ticket = ticketRows[0];
      if (!ticket) throw new Error("Ticket não encontrado.");
      const deadlines = supportDeadlines(input.priority,String(ticket.created_at));
      const rows = await tx`
        UPDATE beta_support_tickets SET
          status=${input.status},priority=${input.priority},
          assigned_to=COALESCE(${input.assignedTo ?? null}::uuid,assigned_to),
          first_response_due_at=${deadlines.firstResponseDueAt},
          resolution_due_at=${deadlines.resolutionDueAt},
          acknowledged_at=CASE
            WHEN ${input.status} IN (
              'acknowledged','in-progress','waiting-user','resolved','closed'
            ) THEN COALESCE(acknowledged_at,now())
            ELSE acknowledged_at
          END,
          resolved_at=CASE
            WHEN ${input.status} IN ('resolved','closed')
            THEN COALESCE(resolved_at,now()) ELSE resolved_at
          END,
          closed_at=CASE
            WHEN ${input.status}='closed' THEN COALESCE(closed_at,now())
            ELSE closed_at
          END,
          updated_at=now()
        WHERE id=${input.ticketId}::uuid RETURNING ticket_key
      `;
      await tx`
        INSERT INTO beta_support_updates (
          id,ticket_id,author_user_id,status,message,visible_to_user
        ) VALUES (
          ${randomUUID()}::uuid,${input.ticketId}::uuid,${input.actorId}::uuid,
          ${input.status},
          pgp_sym_encrypt(
            ${input.message.slice(0,8000)},${dataEncryptionKey()},'cipher-algo=aes256'
          ),
          ${input.visibleToUser}
        )
      `;
      await this.outbox(tx,input.ticketId,"beta.support.ticket.updated",{
        ticketKey: rows[0]?.ticket_key,
        status: input.status,
        priority: input.priority,
        visibleToUser: input.visibleToUser
      });
      await this.syncGatesTx(tx,input.actorId);
    });
  }

  async ticketsForUser(userId: string): Promise<readonly SupportTicketView[]> {
    return this.ticketRows({ userId,includeInternalUpdates: false });
  }

  async createFlag(input: {
    actorId: string;
    idempotencyKey: string;
    flagKey: string;
    label: string;
    description: string;
    defaultVariant: string;
    variants: readonly string[];
    rolloutPercent: number;
    targetWaveIds: readonly string[];
    safetyThresholds?: unknown;
  }): Promise<FeatureFlagView> {
    const variants = [...new Set(input.variants.map((value) => value.trim()))]
      .filter(Boolean);
    if (variants.length < 1 || variants.length > 10) {
      throw new Error("A flag deve possuir entre uma e dez variantes.");
    }
    if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(input.flagKey)) {
      throw new Error("Chave de feature flag inválida.");
    }
    return this.idempotent(
      `beta-feature-flag:${input.actorId}:${input.idempotencyKey}`,
      input.actorId,
      input,
      async (tx) => {
        await this.assertAdministrativeActor(tx,input.actorId,["platform-admin"]);
        const id = randomUUID();
        const rows = await tx`
          INSERT INTO beta_feature_flags (
            id,flag_key,label,description,default_variant,variants,
            rollout_percent,target_wave_ids,safety_thresholds,created_by,updated_by
          ) VALUES (
            ${id}::uuid,${input.flagKey},${input.label.slice(0,160)},
            ${input.description.slice(0,4000)},${input.defaultVariant.slice(0,80)},
            ${JSON.stringify(variants)}::jsonb,${input.rolloutPercent},
            ${input.targetWaveIds}::uuid[],
            ${JSON.stringify(input.safetyThresholds ?? {})}::jsonb,
            ${input.actorId}::uuid,${input.actorId}::uuid
          ) RETURNING *
        `;
        await this.outbox(tx,id,"beta.feature-flag.created",{
          flagKey: input.flagKey,
          rolloutPercent: input.rolloutPercent
        });
        return this.mapFlag(rows[0],0,0);
      }
    );
  }

  async recordFlagApproval(input: {
    actorId: string;
    flagId: string;
    decision: "approve" | "reject";
    note: string;
  }): Promise<void> {
    await this.sql.begin("isolation level serializable",async (tx) => {
      await this.assertAdministrativeActor(tx,input.actorId,["platform-admin"]);
      const rows = await tx`
        SELECT id,created_by,status FROM beta_feature_flags
        WHERE id=${input.flagId}::uuid FOR UPDATE
      `;
      const flag = rows[0];
      if (!flag) throw new Error("Feature flag não encontrada.");
      if (String(flag.created_by) === input.actorId) {
        throw new Error("O criador não pode aprovar a própria feature flag.");
      }
      if (String(flag.status) === "retired") {
        throw new Error("Feature flag aposentada não aceita novas aprovações.");
      }
      await tx`
        INSERT INTO beta_feature_flag_approvals (
          flag_id,actor_id,decision,note
        ) VALUES (
          ${input.flagId}::uuid,${input.actorId}::uuid,
          ${input.decision},${input.note.slice(0,4000)}
        )
        ON CONFLICT (flag_id,actor_id) DO UPDATE SET
          decision=excluded.decision,note=excluded.note,updated_at=now()
      `;
      const counts = await tx`
        SELECT
          count(*) FILTER (WHERE decision='approve')::int approvals,
          count(*) FILTER (WHERE decision='reject')::int rejections
        FROM beta_feature_flag_approvals
        WHERE flag_id=${input.flagId}::uuid
      `;
      const status = approvalDerivedStatus({
        currentStatus: String(flag.status) as FeatureFlagStatus,
        approvals: Number(counts[0]?.approvals ?? 0),
        rejections: Number(counts[0]?.rejections ?? 0)
      });
      await tx`
        UPDATE beta_feature_flags SET
          status=${status},updated_by=${input.actorId}::uuid,updated_at=now()
        WHERE id=${input.flagId}::uuid
      `;
      await this.syncGatesTx(tx,input.actorId);
    });
  }

  async activateFlag(input: {
    actorId: string;
    flagId: string;
  }): Promise<void> {
    await this.sql.begin("isolation level serializable",async (tx) => {
      await this.assertAdministrativeActor(tx,input.actorId,["platform-admin"]);
      const rows = await tx`
        SELECT flag.id,flag.flag_key,flag.status,
          count(approval.actor_id) FILTER (
            WHERE approval.decision='approve'
          )::int approvals,
          count(approval.actor_id) FILTER (
            WHERE approval.decision='reject'
          )::int rejections
        FROM beta_feature_flags flag
        LEFT JOIN beta_feature_flag_approvals approval ON approval.flag_id=flag.id
        WHERE flag.id=${input.flagId}::uuid
        GROUP BY flag.id
        FOR UPDATE OF flag
      `;
      const flag = rows[0];
      if (!flag) throw new Error("Feature flag não encontrada.");
      if (Number(flag.approvals ?? 0) < 2 || Number(flag.rejections ?? 0) > 0) {
        throw new Error("A flag exige duas aprovações e nenhuma rejeição.");
      }
      if (!["ready","paused"].includes(String(flag.status))) {
        throw new Error("A flag precisa estar pronta ou pausada para ativação.");
      }
      await tx`
        UPDATE beta_feature_flags SET
          status='active',activated_at=COALESCE(activated_at,now()),paused_at=NULL,
          updated_by=${input.actorId}::uuid,updated_at=now()
        WHERE id=${input.flagId}::uuid
      `;
      await this.outbox(tx,input.flagId,"beta.feature-flag.activated",{
        flagKey: flag.flag_key
      });
      await this.syncGatesTx(tx,input.actorId);
    });
  }

  async pauseFlag(input: {
    actorId: string;
    flagId: string;
    reason: string;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      await this.assertAdministrativeActor(tx,input.actorId,["platform-admin"]);
      const rows = await tx`
        UPDATE beta_feature_flags SET
          status='paused',paused_at=now(),updated_by=${input.actorId}::uuid,
          updated_at=now()
        WHERE id=${input.flagId}::uuid AND status='active'
        RETURNING flag_key
      `;
      if (!rows[0]) throw new Error("Feature flag ativa não encontrada.");
      await this.outbox(tx,input.flagId,"beta.feature-flag.paused",{
        flagKey: rows[0].flag_key,
        reason: input.reason.slice(0,1000)
      });
      await this.syncGatesTx(tx,input.actorId);
    });
  }

  async evaluateFlag(input: {
    userId: string;
    flagKey: string;
  }): Promise<FeatureEvaluation> {
    const rows = await this.sql`
      SELECT * FROM beta_feature_flags
      WHERE flag_key=${input.flagKey} AND status='active'
      LIMIT 1
    `;
    const flag = rows[0];
    if (!flag) {
      return {
        flagKey: input.flagKey,enabled: false,variant: "control",
        bucket: 0,waveId: null,exposedAt: null
      };
    }
    const targetWaveIds = stringArray(flag.target_wave_ids);
    const memberships = await this.sql`
      SELECT member.wave_id
      FROM beta_wave_members member
      WHERE member.user_id=${input.userId}::uuid
        AND member.status IN ('active','paused','completed')
      ORDER BY member.activated_at DESC NULLS LAST,member.enrolled_at DESC
    `;
    const membershipWaveIds = memberships.map((row) => String(row.wave_id));
    const waveId = targetWaveIds.length === 0
      ? membershipWaveIds[0] ?? null
      : membershipWaveIds.find((id) => targetWaveIds.includes(id)) ?? null;
    if (targetWaveIds.length > 0 && !waveId) {
      return {
        flagKey: input.flagKey,enabled: false,
        variant: String(flag.default_variant),bucket: 0,waveId: null,exposedAt: null
      };
    }
    const decision = deterministicFeatureDecision({
      userId: input.userId,
      flagKey: input.flagKey,
      rolloutPercent: Number(flag.rollout_percent),
      variants: stringArray(flag.variants),
      defaultVariant: String(flag.default_variant)
    });
    if (!decision.enabled) {
      return { flagKey: input.flagKey,...decision,waveId,exposedAt: null };
    }
    const exposureId = randomUUID();
    await this.sql`
      INSERT INTO beta_feature_exposures (
        id,flag_id,user_id,wave_id,variant,bucket
      ) VALUES (
        ${exposureId}::uuid,${String(flag.id)}::uuid,${input.userId}::uuid,
        ${waveId}::uuid,${decision.variant},${decision.bucket}
      )
      ON CONFLICT (flag_id,user_id) DO NOTHING
    `;
    const exposure = await this.sql`
      SELECT exposed_at,variant,bucket,wave_id
      FROM beta_feature_exposures
      WHERE flag_id=${String(flag.id)}::uuid AND user_id=${input.userId}::uuid
    `;
    return {
      flagKey: input.flagKey,
      enabled: true,
      variant: String(exposure[0]?.variant ?? decision.variant),
      bucket: Number(exposure[0]?.bucket ?? decision.bucket),
      waveId: exposure[0]?.wave_id ? String(exposure[0].wave_id) : waveId,
      exposedAt: optionalIso(exposure[0]?.exposed_at)
    };
  }

  async readiness(): Promise<SupportRolloutReadiness> {
    const [support,flags] = await Promise.all([
      this.sql`
        SELECT
          count(*) FILTER (
            WHERE status NOT IN ('resolved','closed') AND (
              (acknowledged_at IS NULL AND first_response_due_at<now())
              OR resolution_due_at<now()
            )
          )::int support_breaches,
          count(*) FILTER (
            WHERE priority='critical' AND status NOT IN ('resolved','closed')
          )::int open_critical
        FROM beta_support_tickets
      `,
      this.sql`
        SELECT count(*)::int approved_flags
        FROM beta_feature_flags flag
        WHERE flag.status IN ('ready','active')
          AND (
            SELECT count(*) FROM beta_feature_flag_approvals approval
            WHERE approval.flag_id=flag.id AND approval.decision='approve'
          )>=2
          AND NOT EXISTS (
            SELECT 1 FROM beta_feature_flag_approvals rejection
            WHERE rejection.flag_id=flag.id AND rejection.decision='reject'
          )
      `
    ]);
    return evaluateSupportRolloutReadiness({
      supportBreaches: Number(support[0]?.support_breaches ?? 0),
      openCriticalTickets: Number(support[0]?.open_critical ?? 0),
      approvedFlags: Number(flags[0]?.approved_flags ?? 0)
    });
  }

  async syncGates(actorId?: string): Promise<void> {
    await this.sql.begin(async (tx) => this.syncGatesTx(tx,actorId));
  }

  async adminState(): Promise<Readonly<{
    readiness: SupportRolloutReadiness;
    tickets: readonly SupportTicketView[];
    flags: readonly FeatureFlagView[];
  }>> {
    const [readiness,tickets,flags] = await Promise.all([
      this.readiness(),
      this.ticketRows({ includeInternalUpdates: true }),
      this.flagRows()
    ]);
    return { readiness,tickets,flags };
  }

  private async ticketRows(input: {
    userId?: string | undefined;
    includeInternalUpdates: boolean;
  }): Promise<readonly SupportTicketView[]> {
    const rows = input.userId
      ? await this.sql`
          SELECT ticket.*,
            pgp_sym_decrypt(ticket.details,${dataEncryptionKey()}) details_plaintext
          FROM beta_support_tickets ticket
          WHERE ticket.user_id=${input.userId}::uuid
          ORDER BY ticket.created_at DESC LIMIT 200
        `
      : await this.sql`
          SELECT ticket.*,
            pgp_sym_decrypt(ticket.details,${dataEncryptionKey()}) details_plaintext
          FROM beta_support_tickets ticket
          ORDER BY
            CASE ticket.priority
              WHEN 'critical' THEN 0 WHEN 'high' THEN 1
              WHEN 'normal' THEN 2 ELSE 3 END,
            ticket.created_at DESC
          LIMIT 500
        `;
    const ids = rows.map((row) => String(row.id));
    const updates = ids.length === 0 ? [] : await this.sql`
      SELECT support_update.*,
        pgp_sym_decrypt(support_update.message,${dataEncryptionKey()}) message_plaintext
      FROM beta_support_updates support_update
      WHERE support_update.ticket_id=ANY(${ids}::uuid[])
        ${input.includeInternalUpdates
          ? this.sql``
          : this.sql`AND support_update.visible_to_user=true`}
      ORDER BY support_update.created_at,support_update.id
    `;
    return rows.map((row) => this.mapTicket(
      row,
      String(row.details_plaintext),
      updates
        .filter((supportUpdate) => String(supportUpdate.ticket_id) === String(row.id))
        .map((supportUpdate) => this.mapUpdate(supportUpdate))
    ));
  }

  private async flagRows(): Promise<readonly FeatureFlagView[]> {
    const rows = await this.sql`
      SELECT flag.*,
        count(approval.actor_id) FILTER (
          WHERE approval.decision='approve'
        )::int approvals,
        count(approval.actor_id) FILTER (
          WHERE approval.decision='reject'
        )::int rejections
      FROM beta_feature_flags flag
      LEFT JOIN beta_feature_flag_approvals approval ON approval.flag_id=flag.id
      GROUP BY flag.id
      ORDER BY flag.updated_at DESC LIMIT 200
    `;
    return rows.map((row) => this.mapFlag(
      row,
      Number(row.approvals ?? 0),
      Number(row.rejections ?? 0)
    ));
  }

  private async assertAdministrativeActor(
    tx: Tx,
    actorId: string,
    roles: readonly string[]
  ): Promise<void> {
    const rows = await tx`
      SELECT account.id
      FROM users account
      WHERE account.id=${actorId}::uuid AND account.status='active'
        AND EXISTS (
          SELECT 1 FROM user_roles role
          WHERE role.user_id=account.id AND role.role=ANY(${roles}::text[])
        )
    `;
    if (!rows[0]) {
      throw new Error("Responsável precisa ser um administrador ativo autorizado.");
    }
  }

  private async syncGatesTx(tx: Tx,actorId?: string): Promise<void> {
    const support = await tx`
      SELECT
        count(*) FILTER (
          WHERE status NOT IN ('resolved','closed') AND (
            (acknowledged_at IS NULL AND first_response_due_at<now())
            OR resolution_due_at<now()
          )
        )::int support_breaches,
        count(*) FILTER (
          WHERE priority='critical' AND status NOT IN ('resolved','closed')
        )::int open_critical
      FROM beta_support_tickets
    `;
    const flags = await tx`
      SELECT count(*)::int approved_flags
      FROM beta_feature_flags flag
      WHERE flag.status IN ('ready','active')
        AND (
          SELECT count(*) FROM beta_feature_flag_approvals approval
          WHERE approval.flag_id=flag.id AND approval.decision='approve'
        )>=2
        AND NOT EXISTS (
          SELECT 1 FROM beta_feature_flag_approvals rejection
          WHERE rejection.flag_id=flag.id AND rejection.decision='reject'
        )
    `;
    const state = evaluateSupportRolloutReadiness({
      supportBreaches: Number(support[0]?.support_breaches ?? 0),
      openCriticalTickets: Number(support[0]?.open_critical ?? 0),
      approvedFlags: Number(flags[0]?.approved_flags ?? 0)
    });
    await tx`
      UPDATE release_gate_checks SET
        status=${state.supportHealthy ? "passing" : "blocked"},
        evidence=${JSON.stringify({
          supportBreaches: state.supportBreaches,
          openCriticalTickets: state.openCriticalTickets
        })}::jsonb,
        checked_at=now(),updated_by=${actorId ?? null}::uuid,updated_at=now()
      WHERE gate_key='beta-support-sla-operational'
    `;
    await tx`
      UPDATE release_gate_checks SET
        status=${state.rolloutPrepared ? "passing" : "pending"},
        evidence=${JSON.stringify({ approvedFlags: state.approvedFlags })}::jsonb,
        checked_at=now(),updated_by=${actorId ?? null}::uuid,updated_at=now()
      WHERE gate_key='feature-rollout-prepared'
    `;
  }

  private mapTicket(
    row: Record<string,unknown> | undefined,
    details: string,
    updates: readonly SupportUpdateView[]
  ): SupportTicketView {
    if (!row) throw new Error("Ticket não pôde ser criado.");
    return {
      id: String(row.id),ticketKey: String(row.ticket_key),userId: String(row.user_id),
      waveId: row.wave_id ? String(row.wave_id) : null,
      category: String(row.category),priority: String(row.priority) as SupportPriority,
      subject: String(row.subject),details,
      status: String(row.status) as SupportTicketStatus,
      assignedTo: row.assigned_to ? String(row.assigned_to) : null,
      firstResponseDueAt: iso(row.first_response_due_at),
      resolutionDueAt: iso(row.resolution_due_at),
      acknowledgedAt: optionalIso(row.acknowledged_at),
      resolvedAt: optionalIso(row.resolved_at),closedAt: optionalIso(row.closed_at),
      createdAt: iso(row.created_at),updatedAt: iso(row.updated_at),updates
    };
  }

  private mapUpdate(row: Record<string,unknown>): SupportUpdateView {
    return {
      id: String(row.id),status: String(row.status) as SupportTicketStatus,
      message: String(row.message_plaintext),visibleToUser: Boolean(row.visible_to_user),
      authorUserId: String(row.author_user_id),createdAt: iso(row.created_at)
    };
  }

  private mapFlag(
    row: Record<string,unknown> | undefined,
    approvals: number,
    rejections: number
  ): FeatureFlagView {
    if (!row) throw new Error("Feature flag não pôde ser criada.");
    return {
      id: String(row.id),flagKey: String(row.flag_key),label: String(row.label),
      description: String(row.description),status: String(row.status) as FeatureFlagStatus,
      defaultVariant: String(row.default_variant),variants: stringArray(row.variants),
      rolloutPercent: Number(row.rollout_percent),
      targetWaveIds: stringArray(row.target_wave_ids),
      safetyThresholds: row.safety_thresholds,approvals,rejections,
      createdBy: String(row.created_by),updatedBy: String(row.updated_by),
      activatedAt: optionalIso(row.activated_at),pausedAt: optionalIso(row.paused_at),
      createdAt: iso(row.created_at),updatedAt: iso(row.updated_at)
    };
  }
}
