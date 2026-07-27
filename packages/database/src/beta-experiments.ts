import { randomUUID } from "node:crypto";
import { EconomyRepositoryBase,type Tx } from "./economy-base.js";
import {
  evaluateExperiment,
  type ExperimentRecommendation,
  type VariantObservation
} from "./beta-experiment-rules.js";

export type ExperimentStatus = "draft" | "approved" | "running" | "paused" | "completed" | "cancelled";

export type ExperimentView = Readonly<{
  id: string;
  experimentKey: string;
  flagId: string;
  flagKey: string;
  label: string;
  hypothesis: string;
  decisionQuestion: string;
  primaryMetric: string;
  secondaryMetrics: readonly string[];
  guardrails: unknown;
  minimumSample: number;
  minimumRuntimeHours: number;
  minimumLiftPercent: number;
  status: ExperimentStatus;
  approvals: number;
  rejections: number;
  startsAt: string | null;
  endsAt: string | null;
  startedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}>;

export type ExperimentResultView = Readonly<{
  id: string;
  experimentId: string;
  variant: string;
  periodStart: string;
  periodEnd: string;
  exposedUsers: number;
  activeUsers: number;
  primaryMetricValue: number;
  recommendation: ExperimentRecommendation;
  evidence: unknown;
  computedAt: string;
}>;

function iso(value: unknown): string { return new Date(String(value)).toISOString(); }
function optionalIso(value: unknown): string | null { return value ? iso(value) : null; }
function strings(value: unknown): readonly string[] { return Array.isArray(value) ? value.map(String) : []; }

export class BetaExperimentService extends EconomyRepositoryBase {
  async createExperiment(input: {
    actorId: string;
    idempotencyKey: string;
    experimentKey: string;
    flagId: string;
    label: string;
    hypothesis: string;
    decisionQuestion: string;
    primaryMetric: "conversion" | "retention-d1" | "retention-d7" | "feedback" | "engagement" | "economy";
    secondaryMetrics: readonly string[];
    guardrails: unknown;
    minimumSample: number;
    minimumRuntimeHours: number;
    minimumLiftPercent: number;
    startsAt?: string;
    endsAt?: string;
  }): Promise<ExperimentView> {
    return this.idempotent(
      `beta-experiment:${input.actorId}:${input.idempotencyKey}`,
      input.actorId,
      input,
      async (tx) => {
        await this.assertPlatformAdmin(tx,input.actorId);
        const flags = await tx`
          SELECT id,flag_key,status FROM beta_feature_flags
          WHERE id=${input.flagId}::uuid
        `;
        if (!flags[0]) throw new Error("Feature flag não encontrada.");
        if (String(flags[0].status) === "retired") {
          throw new Error("Feature flag aposentada não pode receber experimento.");
        }
        const id = randomUUID();
        const rows = await tx`
          INSERT INTO beta_experiments (
            id,experiment_key,flag_id,label,hypothesis,decision_question,
            primary_metric,secondary_metrics,guardrails,minimum_sample,
            minimum_runtime_hours,minimum_lift_percent,starts_at,ends_at,
            created_by,updated_by
          ) VALUES (
            ${id}::uuid,${input.experimentKey},${input.flagId}::uuid,
            ${input.label.slice(0,160)},${input.hypothesis.slice(0,4000)},
            ${input.decisionQuestion.slice(0,1000)},${input.primaryMetric},
            ${input.secondaryMetrics}::text[],${JSON.stringify(input.guardrails ?? {})}::jsonb,
            ${input.minimumSample},${input.minimumRuntimeHours},${input.minimumLiftPercent},
            ${input.startsAt ?? null}::timestamptz,${input.endsAt ?? null}::timestamptz,
            ${input.actorId}::uuid,${input.actorId}::uuid
          ) RETURNING *
        `;
        await this.outbox(tx,id,"beta.experiment.created",{
          experimentKey: input.experimentKey,flagKey: flags[0].flag_key
        });
        return this.mapExperiment({...rows[0],flag_key: flags[0].flag_key},0,0);
      }
    );
  }

  async recordApproval(input: {
    actorId: string;
    experimentId: string;
    decision: "approve" | "reject";
    note: string;
  }): Promise<void> {
    await this.sql.begin("isolation level serializable",async (tx) => {
      await this.assertPlatformAdmin(tx,input.actorId);
      const experiments = await tx`
        SELECT id,created_by,status FROM beta_experiments
        WHERE id=${input.experimentId}::uuid FOR UPDATE
      `;
      const experiment = experiments[0];
      if (!experiment) throw new Error("Experimento não encontrado.");
      if (String(experiment.created_by) === input.actorId) {
        throw new Error("O criador não pode aprovar o próprio experimento.");
      }
      if (["running","completed","cancelled"].includes(String(experiment.status))) {
        throw new Error("O experimento não aceita novas aprovações neste estado.");
      }
      await tx`
        INSERT INTO beta_experiment_approvals (experiment_id,actor_id,decision,note)
        VALUES (${input.experimentId}::uuid,${input.actorId}::uuid,${input.decision},${input.note.slice(0,4000)})
        ON CONFLICT (experiment_id,actor_id) DO UPDATE SET
          decision=excluded.decision,note=excluded.note,updated_at=now()
      `;
      const counts = await this.approvalCounts(tx,input.experimentId);
      const nextStatus = counts.rejections > 0 ? "draft" : counts.approvals >= 2 ? "approved" : "draft";
      await tx`
        UPDATE beta_experiments SET status=${nextStatus},updated_by=${input.actorId}::uuid,updated_at=now()
        WHERE id=${input.experimentId}::uuid
      `;
    });
    await this.syncGate(input.actorId);
  }

  async startExperiment(input: { actorId: string; experimentId: string }): Promise<void> {
    await this.sql.begin("isolation level serializable",async (tx) => {
      await this.assertPlatformAdmin(tx,input.actorId);
      const rows = await tx`
        SELECT experiment.*,flag.status flag_status
        FROM beta_experiments experiment
        JOIN beta_feature_flags flag ON flag.id=experiment.flag_id
        WHERE experiment.id=${input.experimentId}::uuid FOR UPDATE OF experiment
      `;
      const experiment = rows[0];
      if (!experiment) throw new Error("Experimento não encontrado.");
      const counts = await this.approvalCounts(tx,input.experimentId);
      if (counts.approvals < 2 || counts.rejections > 0) {
        throw new Error("O experimento exige duas aprovações e nenhuma rejeição.");
      }
      if (!String(experiment.flag_status).match(/^(active|paused)$/)) {
        throw new Error("A feature flag precisa estar ativa ou pausada.");
      }
      if (!["approved","paused"].includes(String(experiment.status))) {
        throw new Error("O experimento precisa estar aprovado ou pausado.");
      }
      await tx`
        UPDATE beta_experiments SET status='running',started_at=COALESCE(started_at,now()),
          paused_at=NULL,updated_by=${input.actorId}::uuid,updated_at=now()
        WHERE id=${input.experimentId}::uuid
      `;
      await this.outbox(tx,input.experimentId,"beta.experiment.started",{});
    });
    await this.syncGate(input.actorId);
  }

  async pauseExperiment(input: { actorId: string; experimentId: string; reason: string }): Promise<void> {
    await this.sql.begin(async (tx) => {
      await this.assertPlatformAdmin(tx,input.actorId);
      const rows = await tx`
        UPDATE beta_experiments SET status='paused',paused_at=now(),updated_by=${input.actorId}::uuid,updated_at=now()
        WHERE id=${input.experimentId}::uuid AND status='running' RETURNING id
      `;
      if (!rows[0]) throw new Error("Experimento em execução não encontrado.");
      await this.outbox(tx,input.experimentId,"beta.experiment.paused",{ reason: input.reason.slice(0,1000) });
    });
    await this.syncGate(input.actorId);
  }

  async completeExperiment(input: { actorId: string; experimentId: string }): Promise<void> {
    await this.sql.begin(async (tx) => {
      await this.assertPlatformAdmin(tx,input.actorId);
      const decisions = await tx`
        SELECT id FROM beta_experiment_decisions
        WHERE experiment_id=${input.experimentId}::uuid LIMIT 1
      `;
      if (!decisions[0]) throw new Error("Registre uma decisão humana antes de concluir o experimento.");
      const rows = await tx`
        UPDATE beta_experiments SET status='completed',completed_at=now(),
          updated_by=${input.actorId}::uuid,updated_at=now()
        WHERE id=${input.experimentId}::uuid AND status IN ('running','paused') RETURNING id
      `;
      if (!rows[0]) throw new Error("Experimento ativo ou pausado não encontrado.");
      await this.outbox(tx,input.experimentId,"beta.experiment.completed",{});
    });
    await this.syncGate(input.actorId);
  }

  async recordDecision(input: {
    actorId: string;
    experimentId: string;
    decision: ExperimentRecommendation;
    rationale: string;
    evidence: unknown;
    resultIds: readonly string[];
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      await this.assertPlatformAdmin(tx,input.actorId);
      const experiments = await tx`
        SELECT id,status FROM beta_experiments WHERE id=${input.experimentId}::uuid
      `;
      if (!experiments[0]) throw new Error("Experimento não encontrado.");
      if (!['running','paused'].includes(String(experiments[0].status))) {
        throw new Error("Decisões exigem experimento em execução ou pausado.");
      }
      await tx`
        INSERT INTO beta_experiment_decisions (
          id,experiment_id,decision,rationale,evidence,result_ids,created_by
        ) VALUES (
          ${randomUUID()}::uuid,${input.experimentId}::uuid,${input.decision},
          ${input.rationale.slice(0,8000)},${JSON.stringify(input.evidence ?? {})}::jsonb,
          ${input.resultIds}::uuid[],${input.actorId}::uuid
        )
      `;
      await this.outbox(tx,input.experimentId,"beta.experiment.decision-recorded",{
        decision: input.decision,resultIds: input.resultIds
      });
    });
    await this.syncGate(input.actorId);
  }

  async evaluateObservations(input: {
    control: VariantObservation;
    candidate: VariantObservation;
    minimumSample: number;
    minimumRuntimeHours: number;
    minimumLiftPercent: number;
  }) { return evaluateExperiment(input); }

  async adminState(): Promise<Readonly<{
    experiments: readonly ExperimentView[];
    results: readonly ExperimentResultView[];
  }>> {
    const experiments = await this.sql`
      SELECT experiment.*,flag.flag_key,
        count(approval.actor_id) FILTER (WHERE approval.decision='approve')::int approvals,
        count(approval.actor_id) FILTER (WHERE approval.decision='reject')::int rejections
      FROM beta_experiments experiment
      JOIN beta_feature_flags flag ON flag.id=experiment.flag_id
      LEFT JOIN beta_experiment_approvals approval ON approval.experiment_id=experiment.id
      GROUP BY experiment.id,flag.flag_key
      ORDER BY experiment.created_at DESC LIMIT 200
    `;
    const results = await this.sql`
      SELECT * FROM beta_experiment_results ORDER BY period_end DESC,computed_at DESC LIMIT 500
    `;
    return {
      experiments: experiments.map((row) => this.mapExperiment(row,Number(row.approvals),Number(row.rejections))),
      results: results.map((row) => ({
        id:String(row.id),experimentId:String(row.experiment_id),variant:String(row.variant),
        periodStart:String(row.period_start),periodEnd:String(row.period_end),
        exposedUsers:Number(row.exposed_users),activeUsers:Number(row.active_users),
        primaryMetricValue:Number(row.primary_metric_value),
        recommendation:String(row.recommendation) as ExperimentRecommendation,
        evidence:row.evidence,computedAt:iso(row.computed_at)
      }))
    };
  }

  async syncGate(actorId?: string): Promise<void> {
    const rows = await this.sql`
      SELECT
        count(*) FILTER (WHERE status IN ('approved','running','paused','completed'))::int approved,
        count(*) FILTER (WHERE status='running')::int running
      FROM beta_experiments
    `;
    const decisions = await this.sql`SELECT count(*)::int total FROM beta_experiment_decisions`;
    const ready = Number(rows[0]?.approved ?? 0)>0 && Number(decisions[0]?.total ?? 0)>0;
    await this.sql`
      UPDATE release_gate_checks SET status=${ready ? 'passing' : 'pending'},
        evidence=${JSON.stringify({approved:Number(rows[0]?.approved ?? 0),running:Number(rows[0]?.running ?? 0),decisions:Number(decisions[0]?.total ?? 0)})}::jsonb,
        notes=${ready ? 'Experimentação possui aprovação e decisão humana auditável.' : 'Aguardando experimento aprovado e decisão humana.'},
        updated_by=${actorId ?? null}::uuid,updated_at=now()
      WHERE gate_key='beta-experimentation-ready'
    `;
  }

  private async assertPlatformAdmin(tx: Tx,actorId: string): Promise<void> {
    const rows = await tx`
      SELECT account.id FROM users account
      WHERE account.id=${actorId}::uuid AND account.status='active'
        AND EXISTS (SELECT 1 FROM user_roles role WHERE role.user_id=account.id AND role.role='platform-admin')
    `;
    if (!rows[0]) throw new Error("A operação exige administrador de plataforma ativo.");
  }

  private async approvalCounts(tx: Tx,experimentId: string): Promise<{ approvals:number; rejections:number }> {
    const rows = await tx`
      SELECT count(*) FILTER (WHERE decision='approve')::int approvals,
        count(*) FILTER (WHERE decision='reject')::int rejections
      FROM beta_experiment_approvals WHERE experiment_id=${experimentId}::uuid
    `;
    return { approvals:Number(rows[0]?.approvals ?? 0),rejections:Number(rows[0]?.rejections ?? 0) };
  }

  private mapExperiment(row: Record<string,unknown>,approvals:number,rejections:number): ExperimentView {
    return {
      id:String(row.id),experimentKey:String(row.experiment_key),flagId:String(row.flag_id),
      flagKey:String(row.flag_key),label:String(row.label),hypothesis:String(row.hypothesis),
      decisionQuestion:String(row.decision_question),primaryMetric:String(row.primary_metric),
      secondaryMetrics:strings(row.secondary_metrics),guardrails:row.guardrails,
      minimumSample:Number(row.minimum_sample),minimumRuntimeHours:Number(row.minimum_runtime_hours),
      minimumLiftPercent:Number(row.minimum_lift_percent),status:String(row.status) as ExperimentStatus,
      approvals,rejections,startsAt:optionalIso(row.starts_at),endsAt:optionalIso(row.ends_at),
      startedAt:optionalIso(row.started_at),pausedAt:optionalIso(row.paused_at),
      completedAt:optionalIso(row.completed_at),createdBy:String(row.created_by),
      createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)
    };
  }
}

// Tehkné Solutions
