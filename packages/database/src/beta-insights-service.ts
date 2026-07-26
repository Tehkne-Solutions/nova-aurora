import { randomUUID } from "node:crypto";
import { dataEncryptionKey } from "./data-protection.js";
import { EconomyRepositoryBase, type Tx } from "./economy-base.js";
import type { AuthenticatedIdentity } from "./auth-security.js";
import {
  ALLOWED_PRODUCT_EVENTS,
  deterministicFeatureDecision,
  evaluateBetaInsightsReadiness,
  sanitizeProductProperties,
  type AllowedProductEvent,
  type BetaInsightsReadiness
} from "./beta-insights-rules.js";

export type ProductEventInput = Readonly<{
  clientEventId: string;
  eventKey: AllowedProductEvent;
  occurredAt: string;
  route?: string | undefined;
  waveId?: string | undefined;
  schemaVersion?: number | undefined;
  properties?: unknown;
}>;

export type SupportTicketView = Readonly<{
  id: string;
  ticketKey: string;
  userId: string;
  category: string;
  priority: string;
  subject: string;
  details: string;
  status: string;
  assignedTo: string | null;
  firstResponseDueAt: string;
  resolutionDueAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updates: readonly Readonly<{
    id: string;
    status: string;
    message: string;
    visibleToUser: boolean;
    createdAt: string;
  }>[];
}>;

export type FeatureFlagView = Readonly<{
  id: string;
  key: string;
  label: string;
  description: string;
  status: string;
  defaultVariant: string;
  variants: readonly string[];
  rolloutPercent: number;
  targetWaveIds: readonly string[];
  safetyThresholds: unknown;
  approvals: number;
  rejections: number;
  activatedAt: string | null;
  pausedAt: string | null;
  createdAt: string;
}>;

function iso(value: unknown): string | null {
  return value ? new Date(String(value)).toISOString() : null;
}

function ticketSla(priority: "low" | "normal" | "high" | "critical"): {
  firstResponseMinutes: number;
  resolutionMinutes: number;
} {
  if (priority === "critical") return { firstResponseMinutes: 15, resolutionMinutes: 240 };
  if (priority === "high") return { firstResponseMinutes: 60, resolutionMinutes: 1440 };
  if (priority === "low") return { firstResponseMinutes: 1440, resolutionMinutes: 10080 };
  return { firstResponseMinutes: 480, resolutionMinutes: 4320 };
}

function futureDate(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function validOccurredAt(value: string): Date {
  const occurredAt = new Date(value);
  if (Number.isNaN(occurredAt.getTime())) throw new Error("occurredAt inválido.");
  const now = Date.now();
  if (occurredAt.getTime() > now + 5 * 60_000) {
    throw new Error("Evento de produto não pode estar no futuro.");
  }
  if (occurredAt.getTime() < now - 7 * 24 * 60 * 60_000) {
    throw new Error("Evento de produto excedeu a janela de sete dias.");
  }
  return occurredAt;
}

export class BetaInsightsService extends EconomyRepositoryBase {
  async ingestEvents(input: {
    identity: AuthenticatedIdentity;
    events: readonly ProductEventInput[];
    idempotencyKey: string;
  }): Promise<Readonly<{ accepted: number; duplicates: number }>> {
    if (input.events.length === 0 || input.events.length > 50) {
      throw new Error("Envie entre 1 e 50 eventos por lote.");
    }
    const result = await this.idempotent(
      `beta-events:${input.idempotencyKey}`,
      input.identity.userId,
      input.events,
      async (tx) => {
        let accepted = 0;
        let duplicates = 0;
        for (const event of input.events) {
          if (!ALLOWED_PRODUCT_EVENTS.includes(event.eventKey)) {
            throw new Error(`Evento de produto não permitido: ${event.eventKey}.`);
          }
          const occurredAt = validOccurredAt(event.occurredAt);
          const properties = sanitizeProductProperties(event.properties);
          const rows = await tx`
            INSERT INTO beta_product_events (
              id,client_event_id,event_key,user_id,session_id,wave_id,route,
              schema_version,properties,occurred_at
            ) VALUES (
              ${randomUUID()}::uuid,${event.clientEventId},${event.eventKey},
              ${input.identity.userId}::uuid,${input.identity.sessionId}::uuid,
              ${event.waveId ?? null}::uuid,${event.route?.slice(0,240) ?? null},
              ${event.schemaVersion ?? 1},${JSON.stringify(properties)}::jsonb,
              ${occurredAt.toISOString()}
            )
            ON CONFLICT (client_event_id) DO NOTHING
            RETURNING id
          `;
          if (rows[0]) accepted += 1;
          else duplicates += 1;
        }
        return { accepted, duplicates };
      }
    );
    await this.refreshGates();
    return result;
  }

  async submitFeedback(input: {
    identity: AuthenticatedIdentity;
    category: "gameplay" | "economy" | "usability" | "performance" | "accessibility" | "trust" | "other";
    rating: number;
    summary: string;
    details: string;
    idempotencyKey: string;
  }): Promise<Readonly<{ feedbackKey: string; status: string }>> {
    return this.idempotent(
      `beta-feedback:${input.idempotencyKey}`,
      input.identity.userId,
      { category: input.category, rating: input.rating, summary: input.summary, details: input.details },
      async (tx) => {
        const id = randomUUID();
        const feedbackKey = `FDB-${new Date().getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}`;
        await tx`
          INSERT INTO beta_feedback_items (
            id,feedback_key,submission_key,user_id,category,rating,summary,details
          ) VALUES (
            ${id}::uuid,${feedbackKey},${input.idempotencyKey},${input.identity.userId}::uuid,
            ${input.category},${input.rating},${input.summary.slice(0,500)},
            pgp_sym_encrypt(${input.details.slice(0,8000)},${dataEncryptionKey()},'cipher-algo=aes256')
          )
        `;
        await this.outbox(tx, id, "beta.feedback.submitted", {
          feedbackKey,
          userId: input.identity.userId,
          category: input.category,
          rating: input.rating
        });
        return { feedbackKey, status: "open" };
      }
    );
  }

  async createSupportTicket(input: {
    identity: AuthenticatedIdentity;
    category: "account" | "billing-internal" | "gameplay" | "economy" | "technical" | "safety" | "privacy" | "other";
    priority: "low" | "normal" | "high" | "critical";
    subject: string;
    details: string;
    idempotencyKey: string;
  }): Promise<Readonly<{ ticketKey: string; status: string; firstResponseDueAt: string }>> {
    const result = await this.idempotent(
      `beta-support:${input.idempotencyKey}`,
      input.identity.userId,
      { category: input.category, priority: input.priority, subject: input.subject, details: input.details },
      async (tx) => {
        const id = randomUUID();
        const ticketKey = `SUP-${new Date().getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}`;
        const sla = ticketSla(input.priority);
        const firstResponseDueAt = futureDate(sla.firstResponseMinutes);
        const resolutionDueAt = futureDate(sla.resolutionMinutes);
        await tx`
          INSERT INTO beta_support_tickets (
            id,ticket_key,submission_key,user_id,category,priority,subject,details,
            first_response_due_at,resolution_due_at
          ) VALUES (
            ${id}::uuid,${ticketKey},${input.idempotencyKey},${input.identity.userId}::uuid,
            ${input.category},${input.priority},${input.subject.slice(0,240)},
            pgp_sym_encrypt(${input.details.slice(0,8000)},${dataEncryptionKey()},'cipher-algo=aes256'),
            ${firstResponseDueAt},${resolutionDueAt}
          )
        `;
        await this.outbox(tx, id, "beta.support.created", {
          ticketKey,
          userId: input.identity.userId,
          category: input.category,
          priority: input.priority
        });
        return { ticketKey, status: "open", firstResponseDueAt };
      }
    );
    await this.refreshGates();
    return result;
  }

  async userState(userId: string): Promise<Readonly<{
    feedback: readonly unknown[];
    tickets: readonly SupportTicketView[];
    flags: readonly Readonly<{ key: string; variant: string; exposedAt: string }>[];
  }>> {
    const [feedback, ticketRows, exposures] = await Promise.all([
      this.sql`
        SELECT feedback_key,category,rating,summary,status,created_at,updated_at
        FROM beta_feedback_items WHERE user_id=${userId}::uuid
        ORDER BY created_at DESC LIMIT 100
      `,
      this.sql`
        SELECT ticket.*,pgp_sym_decrypt(ticket.details,${dataEncryptionKey()}) details_plaintext
        FROM beta_support_tickets ticket WHERE user_id=${userId}::uuid
        ORDER BY created_at DESC LIMIT 100
      `,
      this.sql`
        SELECT flag.flag_key,exposure.variant,exposure.exposed_at
        FROM beta_feature_exposures exposure
        JOIN beta_feature_flags flag ON flag.id=exposure.flag_id
        WHERE exposure.user_id=${userId}::uuid
        ORDER BY exposure.exposed_at DESC
      `
    ]);
    const tickets: SupportTicketView[] = [];
    for (const row of ticketRows) tickets.push(await this.ticketView(row, true));
    return {
      feedback: feedback.map((row) => ({
        feedbackKey: String(row.feedback_key),
        category: String(row.category),
        rating: Number(row.rating),
        summary: String(row.summary),
        status: String(row.status),
        createdAt: new Date(String(row.created_at)).toISOString(),
        updatedAt: new Date(String(row.updated_at)).toISOString()
      })),
      tickets,
      flags: exposures.map((row) => ({
        key: String(row.flag_key),
        variant: String(row.variant),
        exposedAt: new Date(String(row.exposed_at)).toISOString()
      }))
    };
  }

  async adminState(): Promise<Readonly<{
    readiness: BetaInsightsReadiness;
    metrics: Readonly<{
      events24h: number;
      activeUsers7d: number;
      averageRating: number | null;
      openFeedback: number;
      openSupport: number;
      supportBreaches: number;
      criticalTickets: number;
    }>;
    funnel: readonly Readonly<{ eventKey: string; total: number; users: number }>[];
    feedback: readonly unknown[];
    tickets: readonly SupportTicketView[];
    flags: readonly FeatureFlagView[];
  }>> {
    const [readiness, metricsRows, funnel, feedback, ticketRows, flags] = await Promise.all([
      this.readiness(),
      this.sql`
        SELECT
          (SELECT count(*)::int FROM beta_product_events WHERE occurred_at>=now()-interval '24 hours') events_24h,
          (SELECT count(DISTINCT user_id)::int FROM beta_product_events WHERE occurred_at>=now()-interval '7 days') active_users_7d,
          (SELECT avg(rating)::numeric(8,2) FROM beta_feedback_items) average_rating,
          (SELECT count(*)::int FROM beta_feedback_items WHERE status='open') open_feedback,
          (SELECT count(*)::int FROM beta_support_tickets WHERE status NOT IN ('resolved','closed')) open_support,
          (SELECT count(*)::int FROM beta_support_tickets WHERE status NOT IN ('resolved','closed') AND (
            (acknowledged_at IS NULL AND first_response_due_at<now()) OR resolution_due_at<now()
          )) support_breaches,
          (SELECT count(*)::int FROM beta_support_tickets WHERE priority='critical' AND status NOT IN ('resolved','closed')) critical_tickets
      `,
      this.sql`
        SELECT event_key,count(*)::int total,count(DISTINCT user_id)::int users
        FROM beta_product_events WHERE occurred_at>=now()-interval '30 days'
        GROUP BY event_key ORDER BY total DESC
      `,
      this.sql`
        SELECT feedback.*,pgp_sym_decrypt(feedback.details,${dataEncryptionKey()}) details_plaintext
        FROM beta_feedback_items feedback ORDER BY created_at DESC LIMIT 200
      `,
      this.sql`
        SELECT ticket.*,pgp_sym_decrypt(ticket.details,${dataEncryptionKey()}) details_plaintext
        FROM beta_support_tickets ticket ORDER BY
          CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
          created_at DESC LIMIT 200
      `,
      this.flags()
    ]);
    const tickets: SupportTicketView[] = [];
    for (const row of ticketRows) tickets.push(await this.ticketView(row, false));
    const metric = metricsRows[0] ?? {};
    return {
      readiness,
      metrics: {
        events24h: Number(metric.events_24h ?? 0),
        activeUsers7d: Number(metric.active_users_7d ?? 0),
        averageRating: metric.average_rating === null || metric.average_rating === undefined
          ? null
          : Number(metric.average_rating),
        openFeedback: Number(metric.open_feedback ?? 0),
        openSupport: Number(metric.open_support ?? 0),
        supportBreaches: Number(metric.support_breaches ?? 0),
        criticalTickets: Number(metric.critical_tickets ?? 0)
      },
      funnel: funnel.map((row) => ({
        eventKey: String(row.event_key), total: Number(row.total), users: Number(row.users)
      })),
      feedback: feedback.map((row) => ({
        id: String(row.id), feedbackKey: String(row.feedback_key), userId: String(row.user_id),
        category: String(row.category), rating: Number(row.rating), summary: String(row.summary),
        details: String(row.details_plaintext), status: String(row.status),
        assignedTo: row.assigned_to ? String(row.assigned_to) : null,
        createdAt: new Date(String(row.created_at)).toISOString()
      })),
      tickets,
      flags
    };
  }

  async updateSupportTicket(input: {
    actorId: string;
    ticketId: string;
    status: "open" | "acknowledged" | "in-progress" | "waiting-user" | "resolved" | "closed";
    priority: "low" | "normal" | "high" | "critical";
    message: string;
    visibleToUser: boolean;
    assignedTo?: string | undefined;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      const rows = await tx`
        UPDATE beta_support_tickets SET
          status=${input.status},priority=${input.priority},
          assigned_to=COALESCE(${input.assignedTo ?? null}::uuid,assigned_to,${input.actorId}::uuid),
          acknowledged_at=CASE WHEN ${input.status}<>'open' THEN COALESCE(acknowledged_at,now()) ELSE acknowledged_at END,
          resolved_at=CASE WHEN ${input.status} IN ('resolved','closed') THEN COALESCE(resolved_at,now()) ELSE NULL END,
          updated_at=now()
        WHERE id=${input.ticketId}::uuid RETURNING id,user_id,ticket_key
      `;
      const row = rows[0];
      if (!row) throw new Error("Ticket de suporte não encontrado.");
      await tx`
        INSERT INTO beta_support_updates (
          id,ticket_id,author_user_id,status,message,visible_to_user
        ) VALUES (
          ${randomUUID()}::uuid,${input.ticketId}::uuid,${input.actorId}::uuid,
          ${input.status},pgp_sym_encrypt(${input.message.slice(0,8000)},${dataEncryptionKey()},'cipher-algo=aes256'),
          ${input.visibleToUser}
        )
      `;
      await this.outbox(tx, input.ticketId, "beta.support.updated", {
        ticketKey: String(row.ticket_key),
        userId: String(row.user_id),
        status: input.status,
        visibleToUser: input.visibleToUser
      });
    });
    await this.refreshGates();
  }

  async createFlag(input: {
    actorId: string;
    key: string;
    label: string;
    description: string;
    defaultVariant: string;
    variants: readonly string[];
    rolloutPercent: number;
    targetWaveIds: readonly string[];
    safetyThresholds: unknown;
    idempotencyKey: string;
  }): Promise<FeatureFlagView> {
    const variants = [...new Set(input.variants.map((variant) => variant.trim()).filter(Boolean))];
    if (variants.length === 0 || variants.length > 10) {
      throw new Error("A flag precisa de 1 a 10 variantes.");
    }
    return this.idempotent(
      `beta-flag:${input.idempotencyKey}`,
      input.actorId,
      input,
      async (tx) => {
        const id = randomUUID();
        const rows = await tx`
          INSERT INTO beta_feature_flags (
            id,flag_key,label,description,status,default_variant,variants,
            rollout_percent,target_wave_ids,safety_thresholds,created_by,updated_by
          ) VALUES (
            ${id}::uuid,${input.key},${input.label},${input.description},'draft',
            ${input.defaultVariant},${JSON.stringify(variants)}::jsonb,${input.rolloutPercent},
            ${input.targetWaveIds}::uuid[],${JSON.stringify(input.safetyThresholds)}::jsonb,
            ${input.actorId}::uuid,${input.actorId}::uuid
          )
          RETURNING *
        `;
        const row = rows[0];
        if (!row) throw new Error("Flag não pôde ser criada.");
        return this.flagView(row, 0, 0);
      }
    );
  }

  async approveFlag(input: {
    actorId: string;
    flagId: string;
    decision: "approve" | "reject";
    note: string;
  }): Promise<FeatureFlagView> {
    await this.sql.begin(async (tx) => {
      const flags = await tx`SELECT id,created_by FROM beta_feature_flags WHERE id=${input.flagId}::uuid FOR UPDATE`;
      const flag = flags[0];
      if (!flag) throw new Error("Flag não encontrada.");
      if (String(flag.created_by) === input.actorId) {
        throw new Error("O criador não pode aprovar a própria flag.");
      }
      await tx`
        INSERT INTO beta_feature_flag_approvals (flag_id,actor_id,decision,note)
        VALUES (${input.flagId}::uuid,${input.actorId}::uuid,${input.decision},${input.note})
        ON CONFLICT (flag_id,actor_id) DO UPDATE SET
          decision=excluded.decision,note=excluded.note,created_at=now()
      `;
      const counts = await tx`
        SELECT count(*) FILTER (WHERE decision='approve')::int approvals,
          count(*) FILTER (WHERE decision='reject')::int rejections
        FROM beta_feature_flag_approvals WHERE flag_id=${input.flagId}::uuid
      `;
      const approvalCount = Number(counts[0]?.approvals ?? 0);
      const rejectionCount = Number(counts[0]?.rejections ?? 0);
      await tx`
        UPDATE beta_feature_flags SET
          status=CASE WHEN ${approvalCount}>=2 AND ${rejectionCount}=0 THEN 'ready' ELSE 'draft' END,
          updated_by=${input.actorId}::uuid,updated_at=now()
        WHERE id=${input.flagId}::uuid
      `;
    });
    await this.refreshGates();
    return this.flagById(input.flagId);
  }

  async activateFlag(input: {
    actorId: string;
    flagId: string;
    rolloutPercent: number;
  }): Promise<FeatureFlagView> {
    await this.sql.begin(async (tx) => {
      const flags = await tx`
        SELECT id,status,created_by FROM beta_feature_flags
        WHERE id=${input.flagId}::uuid FOR UPDATE
      `;
      const row = flags[0];
      if (!row) throw new Error("Flag não encontrada.");
      const approvals = await tx`
        SELECT count(*) FILTER (WHERE decision='approve')::int approvals,
          count(*) FILTER (WHERE decision='reject')::int rejections
        FROM beta_feature_flag_approvals WHERE flag_id=${input.flagId}::uuid
      `;
      if (Number(approvals[0]?.approvals ?? 0) < 2 || Number(approvals[0]?.rejections ?? 0) > 0) {
        throw new Error("A ativação exige duas aprovações independentes e nenhuma rejeição.");
      }
      if (String(row.created_by) === input.actorId) {
        throw new Error("O criador não pode executar a ativação final.");
      }
      await tx`
        UPDATE beta_feature_flags SET status='active',rollout_percent=${input.rolloutPercent},
          activated_at=COALESCE(activated_at,now()),paused_at=NULL,
          updated_by=${input.actorId}::uuid,updated_at=now()
        WHERE id=${input.flagId}::uuid
      `;
      await this.outbox(tx, input.flagId, "beta.feature.activated", {
        rolloutPercent: input.rolloutPercent,
        actorId: input.actorId
      });
    });
    await this.refreshGates();
    return this.flagById(input.flagId);
  }

  async pauseFlag(input: { actorId: string; flagId: string; reason: string }): Promise<FeatureFlagView> {
    await this.sql.begin(async (tx) => {
      const rows = await tx`
        UPDATE beta_feature_flags SET status='paused',rollout_percent=0,paused_at=now(),
          updated_by=${input.actorId}::uuid,updated_at=now()
        WHERE id=${input.flagId}::uuid AND status IN ('ready','active') RETURNING id
      `;
      if (!rows[0]) throw new Error("Flag não está pronta ou ativa.");
      await this.outbox(tx, input.flagId, "beta.feature.paused", {
        reason: input.reason,
        actorId: input.actorId
      });
    });
    await this.refreshGates();
    return this.flagById(input.flagId);
  }

  async evaluateFlag(input: {
    identity: AuthenticatedIdentity;
    flagKey: string;
  }): Promise<Readonly<{ enabled: boolean; variant: string; bucket: number; flagKey: string }>> {
    const rows = await this.sql`
      SELECT flag.*,
        EXISTS (
          SELECT 1 FROM beta_wave_members member
          WHERE member.user_id=${input.identity.userId}::uuid
            AND member.status='active'
            AND (cardinality(flag.target_wave_ids)=0 OR member.wave_id=ANY(flag.target_wave_ids))
        ) wave_eligible
      FROM beta_feature_flags flag WHERE flag.flag_key=${input.flagKey}
    `;
    const row = rows[0];
    if (!row || String(row.status) !== "active") {
      return { enabled: false, variant: row ? String(row.default_variant) : "control", bucket: 0, flagKey: input.flagKey };
    }
    const targetWaveIds = (row.target_wave_ids ?? []) as string[];
    if (targetWaveIds.length > 0 && !Boolean(row.wave_eligible)) {
      return { enabled: false, variant: String(row.default_variant), bucket: 0, flagKey: input.flagKey };
    }
    const variants = Array.isArray(row.variants) ? row.variants.map(String) : [];
    const decision = deterministicFeatureDecision({
      userId: input.identity.userId,
      flagKey: input.flagKey,
      rolloutPercent: Number(row.rollout_percent),
      variants,
      defaultVariant: String(row.default_variant)
    });
    if (decision.enabled) {
      const waveRows = await this.sql`
        SELECT wave_id FROM beta_wave_members
        WHERE user_id=${input.identity.userId}::uuid AND status='active'
        ORDER BY activated_at DESC NULLS LAST LIMIT 1
      `;
      await this.sql`
        INSERT INTO beta_feature_exposures (
          id,flag_id,user_id,wave_id,variant,bucket
        ) VALUES (
          ${randomUUID()}::uuid,${String(row.id)}::uuid,${input.identity.userId}::uuid,
          ${waveRows[0]?.wave_id ? String(waveRows[0].wave_id) : null}::uuid,
          ${decision.variant},${decision.bucket}
        )
        ON CONFLICT (flag_id,user_id) DO UPDATE SET
          variant=excluded.variant,bucket=excluded.bucket,exposed_at=now()
      `;
    }
    return { ...decision, flagKey: input.flagKey };
  }

  async readiness(): Promise<BetaInsightsReadiness> {
    const rows = await this.sql`
      SELECT
        (SELECT count(*)::int FROM beta_product_events WHERE occurred_at>=now()-interval '24 hours') events_24h,
        (SELECT count(*)::int FROM beta_support_tickets WHERE status NOT IN ('resolved','closed') AND (
          (acknowledged_at IS NULL AND first_response_due_at<now()) OR resolution_due_at<now()
        )) support_breaches,
        (SELECT count(*)::int FROM beta_support_tickets WHERE priority='critical' AND status NOT IN ('resolved','closed')) critical_tickets,
        (SELECT count(*)::int FROM beta_feature_flags flag WHERE flag.status IN ('ready','active') AND
          (SELECT count(*) FROM beta_feature_flag_approvals approval WHERE approval.flag_id=flag.id AND approval.decision='approve')>=2 AND
          NOT EXISTS (SELECT 1 FROM beta_feature_flag_approvals rejection WHERE rejection.flag_id=flag.id AND rejection.decision='reject')
        ) approved_flags
    `;
    const row = rows[0] ?? {};
    return evaluateBetaInsightsReadiness({
      eventCount24h: Number(row.events_24h ?? 0),
      supportBreaches: Number(row.support_breaches ?? 0),
      openCriticalTickets: Number(row.critical_tickets ?? 0),
      approvedFlags: Number(row.approved_flags ?? 0)
    });
  }

  async refreshGates(): Promise<BetaInsightsReadiness> {
    const readiness = await this.readiness();
    await this.sql.begin(async (tx) => {
      await this.updateGate(tx, "product-telemetry-operational", readiness.telemetryRecent, {
        eventCount24h: readiness.eventCount24h
      });
      await this.updateGate(tx, "beta-support-sla-operational", readiness.supportSlaHealthy, {
        supportBreaches: readiness.supportBreaches,
        openCriticalTickets: readiness.openCriticalTickets
      });
      await this.updateGate(tx, "feature-rollout-prepared", readiness.featureRolloutPrepared, {
        approvedFlags: readiness.approvedFlags
      });
    });
    return readiness;
  }

  async purgeExpiredTelemetry(): Promise<number> {
    const retention = Math.min(Math.max(Number(process.env.PRODUCT_EVENT_RETENTION_DAYS ?? 90), 30), 365);
    const rows = await this.sql`
      DELETE FROM beta_product_events
      WHERE received_at<now()-(${retention}::text || ' days')::interval
      RETURNING id
    `;
    return rows.length;
  }

  private async updateGate(tx: Tx, key: string, passing: boolean, evidence: unknown): Promise<void> {
    await tx`
      UPDATE release_gate_checks SET status=${passing ? "passing" : "pending"},
        evidence=${JSON.stringify(evidence)}::jsonb,updated_at=now()
      WHERE gate_key=${key}
    `;
  }

  private async ticketView(row: Record<string, unknown>, userVisibleOnly: boolean): Promise<SupportTicketView> {
    const updates = userVisibleOnly
      ? await this.sql`
          SELECT update.id,update.status,
            pgp_sym_decrypt(update.message,${dataEncryptionKey()}) message_plaintext,
            update.visible_to_user,update.created_at
          FROM beta_support_updates update
          WHERE update.ticket_id=${String(row.id)}::uuid
            AND update.visible_to_user=true
          ORDER BY update.created_at
        `
      : await this.sql`
          SELECT update.id,update.status,
            pgp_sym_decrypt(update.message,${dataEncryptionKey()}) message_plaintext,
            update.visible_to_user,update.created_at
          FROM beta_support_updates update
          WHERE update.ticket_id=${String(row.id)}::uuid
          ORDER BY update.created_at
        `;
    return {
      id: String(row.id), ticketKey: String(row.ticket_key), userId: String(row.user_id),
      category: String(row.category), priority: String(row.priority), subject: String(row.subject),
      details: String(row.details_plaintext), status: String(row.status),
      assignedTo: row.assigned_to ? String(row.assigned_to) : null,
      firstResponseDueAt: new Date(String(row.first_response_due_at)).toISOString(),
      resolutionDueAt: new Date(String(row.resolution_due_at)).toISOString(),
      acknowledgedAt: iso(row.acknowledged_at), resolvedAt: iso(row.resolved_at),
      createdAt: new Date(String(row.created_at)).toISOString(),
      updates: updates.map((update) => ({
        id: String(update.id), status: String(update.status),
        message: String(update.message_plaintext), visibleToUser: Boolean(update.visible_to_user),
        createdAt: new Date(String(update.created_at)).toISOString()
      }))
    };
  }

  private async flags(): Promise<readonly FeatureFlagView[]> {
    const rows = await this.sql`
      SELECT flag.*,
        count(approval.actor_id) FILTER (WHERE approval.decision='approve')::int approvals,
        count(approval.actor_id) FILTER (WHERE approval.decision='reject')::int rejections
      FROM beta_feature_flags flag
      LEFT JOIN beta_feature_flag_approvals approval ON approval.flag_id=flag.id
      GROUP BY flag.id ORDER BY flag.created_at DESC
    `;
    return rows.map((row) => this.flagView(
      row,
      Number(row.approvals ?? 0),
      Number(row.rejections ?? 0)
    ));
  }

  private async flagById(flagId: string): Promise<FeatureFlagView> {
    const flags = await this.flags();
    const flag = flags.find((item) => item.id === flagId);
    if (!flag) throw new Error("Flag não encontrada.");
    return flag;
  }

  private flagView(row: Record<string, unknown>, approvals: number, rejections: number): FeatureFlagView {
    return {
      id: String(row.id), key: String(row.flag_key), label: String(row.label),
      description: String(row.description), status: String(row.status),
      defaultVariant: String(row.default_variant),
      variants: Array.isArray(row.variants) ? row.variants.map(String) : [],
      rolloutPercent: Number(row.rollout_percent),
      targetWaveIds: Array.isArray(row.target_wave_ids) ? row.target_wave_ids.map(String) : [],
      safetyThresholds: row.safety_thresholds,
      approvals, rejections,
      activatedAt: iso(row.activated_at), pausedAt: iso(row.paused_at),
      createdAt: new Date(String(row.created_at)).toISOString()
    };
  }
}
