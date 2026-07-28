import { randomUUID } from "node:crypto";
import { EconomyRepositoryBase } from "./economy-base.js";
import {
  evaluateExperiment,
  type ExperimentGuardrails,
  type ExperimentPrimaryMetric,
  type ExperimentVariantMetrics
} from "./beta-experiment-rules.js";

function number(value:unknown,fallback=0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function guardrails(value:unknown): ExperimentGuardrails {
  const source = value && typeof value === "object" ? value as Record<string,unknown> : {};
  return {
    maxErrorRatePercent:number(source.maxErrorRatePercent,5),
    maxCriticalFeedback:number(source.maxCriticalFeedback,0),
    maxSupportSlaBreaches:number(source.maxSupportSlaBreaches,0),
    minimumEconomyStabilityScore:number(source.minimumEconomyStabilityScore,80)
  };
}

function primaryMetricValue(metric:ExperimentPrimaryMetric,row:Record<string,unknown>): number {
  switch (metric) {
    case "conversion": return number(row.conversion_percent);
    case "retention-d1": return number(row.retention_d1_percent);
    case "retention-d7": return number(row.retention_d7_percent);
    case "feedback": return number(row.average_feedback_score);
    case "engagement": return number(row.average_session_minutes);
    case "economy": return number(row.economy_stability_score,100);
  }
}

function observation(row:Record<string,unknown>,metric:ExperimentPrimaryMetric): ExperimentVariantMetrics {
  return {
    variant:String(row.variant),
    exposedUsers:number(row.exposed_users),
    activeUsers:number(row.active_users),
    eligibleD1:number(row.eligible_d1),
    eligibleD7:number(row.eligible_d7),
    primaryMetricValue:primaryMetricValue(metric,row),
    errorRatePercent:number(row.error_rate_percent),
    criticalFeedback:number(row.critical_feedback),
    supportSlaBreaches:number(row.support_sla_breaches),
    economyStabilityScore:number(row.economy_stability_score,100)
  };
}

export class BetaExperimentAggregationService extends EconomyRepositoryBase {
  async recomputeRunningExperiments(periodEnd = new Date(Date.now()-86_400_000)): Promise<number> {
    const day = periodEnd.toISOString().slice(0,10);
    const experiments = await this.sql`
      SELECT experiment.*,flag.default_variant
      FROM beta_experiments experiment
      JOIN beta_feature_flags flag ON flag.id=experiment.flag_id
      WHERE experiment.status='running'
        AND experiment.started_at IS NOT NULL
        AND experiment.started_at<(${day}::date+interval '1 day')
        AND (experiment.ends_at IS NULL OR experiment.ends_at>=${day}::date)
      ORDER BY experiment.started_at,experiment.id
    `;
    let written = 0;
    for (const experiment of experiments) {
      written += await this.recomputeExperiment(experiment,day);
    }
    return written;
  }

  private async recomputeExperiment(experiment:Record<string,unknown>,periodEnd:string): Promise<number> {
    const rows = await this.sql`
      WITH exposure AS (
        SELECT exposure.user_id,exposure.variant,exposure.wave_id,exposure.exposed_at
        FROM beta_feature_exposures exposure
        WHERE exposure.flag_id=${String(experiment.flag_id)}::uuid
          AND exposure.exposed_at<(${periodEnd}::date+interval '1 day')
          AND exposure.exposed_at>=${String(experiment.started_at)}::timestamptz
      ), events AS (
        SELECT telemetry.*,exposure.variant,exposure.exposed_at
        FROM beta_telemetry_events telemetry
        JOIN exposure ON exposure.user_id=telemetry.user_id
        WHERE telemetry.occurred_at>=exposure.exposed_at
          AND telemetry.occurred_at<(${periodEnd}::date+interval '1 day')
      ), variants AS (
        SELECT DISTINCT variant FROM exposure
      )
      SELECT variants.variant,
        (SELECT count(DISTINCT user_id) FROM exposure item WHERE item.variant=variants.variant)::int exposed_users,
        (SELECT count(DISTINCT user_id) FROM events item WHERE item.variant=variants.variant)::int active_users,
        (SELECT count(DISTINCT user_id) FROM exposure item WHERE item.variant=variants.variant AND item.exposed_at<(${periodEnd}::date))::int eligible_d1,
        (SELECT count(DISTINCT user_id) FROM exposure item WHERE item.variant=variants.variant AND item.exposed_at<(${periodEnd}::date-interval '6 days'))::int eligible_d7,
        COALESCE((SELECT 100.0*count(DISTINCT item.user_id) FILTER (
          WHERE item.occurred_at::date=item.exposed_at::date+1
        )/NULLIF(count(DISTINCT exposure_d1.user_id),0)
          FROM exposure exposure_d1 LEFT JOIN events item ON item.user_id=exposure_d1.user_id AND item.variant=exposure_d1.variant
          WHERE exposure_d1.variant=variants.variant AND exposure_d1.exposed_at<${periodEnd}::date),0) retention_d1_percent,
        COALESCE((SELECT 100.0*count(DISTINCT item.user_id) FILTER (
          WHERE item.occurred_at::date=item.exposed_at::date+7
        )/NULLIF(count(DISTINCT exposure_d7.user_id),0)
          FROM exposure exposure_d7 LEFT JOIN events item ON item.user_id=exposure_d7.user_id AND item.variant=exposure_d7.variant
          WHERE exposure_d7.variant=variants.variant AND exposure_d7.exposed_at<(${periodEnd}::date-interval '6 days')),0) retention_d7_percent,
        COALESCE((SELECT 100.0*count(DISTINCT user_id) FILTER (WHERE event_type='conversion')/NULLIF(count(DISTINCT user_id),0)
          FROM events item WHERE item.variant=variants.variant),0) conversion_percent,
        COALESCE((SELECT 100.0*count(*) FILTER (WHERE event_type='error')/NULLIF(count(*),0)
          FROM events item WHERE item.variant=variants.variant),0) error_rate_percent,
        COALESCE((SELECT avg(duration_ms)/60000.0 FROM events item
          WHERE item.variant=variants.variant AND event_type='session-end' AND duration_ms IS NOT NULL),0) average_session_minutes,
        COALESCE((SELECT avg(feedback.score) FROM beta_feedback feedback JOIN exposure item ON item.user_id=feedback.user_id
          WHERE item.variant=variants.variant AND feedback.created_at>=item.exposed_at AND feedback.created_at<(${periodEnd}::date+interval '1 day')),0) average_feedback_score,
        COALESCE((SELECT count(*) FROM beta_feedback feedback JOIN exposure item ON item.user_id=feedback.user_id
          WHERE item.variant=variants.variant AND feedback.priority='critical' AND feedback.created_at>=item.exposed_at
            AND feedback.created_at<(${periodEnd}::date+interval '1 day')),0)::int critical_feedback,
        COALESCE((SELECT count(*) FROM beta_support_tickets ticket JOIN exposure item ON item.user_id=ticket.user_id
          WHERE item.variant=variants.variant AND ticket.created_at>=item.exposed_at AND ticket.created_at<(${periodEnd}::date+interval '1 day')),0)::int support_tickets,
        COALESCE((SELECT count(*) FROM beta_support_tickets ticket JOIN exposure item ON item.user_id=ticket.user_id
          WHERE item.variant=variants.variant AND ticket.created_at>=item.exposed_at AND ticket.created_at<(${periodEnd}::date+interval '1 day')
            AND ((ticket.acknowledged_at IS NULL AND ticket.first_response_due_at<now())
              OR (ticket.resolved_at IS NULL AND ticket.resolution_due_at<now()))),0)::int support_sla_breaches,
        COALESCE((SELECT avg(metric.economy_stability_score) FROM beta_daily_metrics metric
          WHERE metric.metric_date BETWEEN ${String(experiment.started_at).slice(0,10)}::date AND ${periodEnd}::date
            AND metric.wave_id IN (SELECT DISTINCT wave_id FROM exposure item WHERE item.variant=variants.variant AND wave_id IS NOT NULL)),100) economy_stability_score
      FROM variants ORDER BY variants.variant
    `;
    if (rows.length===0) return 0;

    const metric = String(experiment.primary_metric) as ExperimentPrimaryMetric;
    const observations = rows.map((row)=>observation(row,metric));
    const control = observations.find((item)=>item.variant===String(experiment.default_variant)) ?? observations[0];
    if (!control) return 0;
    const runtimeHours = Math.max(0,(Date.parse(`${periodEnd}T23:59:59.999Z`)-Date.parse(String(experiment.started_at)))/3_600_000);
    const thresholds = guardrails(experiment.guardrails);

    for (const row of rows) {
      const candidate = observation(row,metric);
      const evaluation = candidate.variant===control.variant
        ? {sampleReady:false,recommendation:"hold" as const,liftPercent:0,guardrailBreaches:[],reasons:["Variante de controle."]}
        : evaluateExperiment({
            primaryMetric:metric,runtimeHours,
            minimumRuntimeHours:number(experiment.minimum_runtime_hours),
            minimumSample:number(experiment.minimum_sample),
            minimumLiftPercent:number(experiment.minimum_lift_percent),
            control,candidate,guardrails:thresholds
          });
      const evidence = {
        sampleReady:evaluation.sampleReady,liftPercent:evaluation.liftPercent,
        guardrailBreaches:evaluation.guardrailBreaches,reasons:evaluation.reasons,
        controlVariant:control.variant,computedBy:"worker"
      };
      await this.sql`
        INSERT INTO beta_experiment_results (
          id,experiment_id,variant,period_start,period_end,exposed_users,active_users,
          eligible_d1,eligible_d7,retention_d1_percent,retention_d7_percent,
          conversion_percent,error_rate_percent,average_session_minutes,
          average_feedback_score,critical_feedback,support_tickets,support_sla_breaches,
          economy_stability_score,primary_metric_value,recommendation,evidence,computed_at
        ) VALUES (
          ${randomUUID()}::uuid,${String(experiment.id)}::uuid,${String(row.variant)},
          ${String(experiment.started_at).slice(0,10)}::date,${periodEnd}::date,
          ${number(row.exposed_users)},${number(row.active_users)},${number(row.eligible_d1)},${number(row.eligible_d7)},
          ${number(row.retention_d1_percent)},${number(row.retention_d7_percent)},${number(row.conversion_percent)},
          ${number(row.error_rate_percent)},${number(row.average_session_minutes)},${number(row.average_feedback_score)},
          ${number(row.critical_feedback)},${number(row.support_tickets)},${number(row.support_sla_breaches)},
          ${number(row.economy_stability_score,100)},${candidate.primaryMetricValue},${evaluation.recommendation},
          ${JSON.stringify(evidence)}::jsonb,now()
        ) ON CONFLICT (experiment_id,variant,period_start,period_end) DO UPDATE SET
          exposed_users=excluded.exposed_users,active_users=excluded.active_users,
          eligible_d1=excluded.eligible_d1,eligible_d7=excluded.eligible_d7,
          retention_d1_percent=excluded.retention_d1_percent,retention_d7_percent=excluded.retention_d7_percent,
          conversion_percent=excluded.conversion_percent,error_rate_percent=excluded.error_rate_percent,
          average_session_minutes=excluded.average_session_minutes,average_feedback_score=excluded.average_feedback_score,
          critical_feedback=excluded.critical_feedback,support_tickets=excluded.support_tickets,
          support_sla_breaches=excluded.support_sla_breaches,economy_stability_score=excluded.economy_stability_score,
          primary_metric_value=excluded.primary_metric_value,recommendation=excluded.recommendation,
          evidence=excluded.evidence,computed_at=now()
      `;
    }
    return rows.length;
  }
}
