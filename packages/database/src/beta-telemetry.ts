import { randomUUID } from "node:crypto";
import { BetaCommunityService } from "./beta-community.js";
import {
  calculateBetaHealth,
  type BetaCommunityReadiness,
  type BetaRecommendation
} from "./beta-telemetry-rules.js";

export type BetaDailyMetricView = Readonly<{
  metricDate: string;
  waveId: string;
  waveKey: string;
  cohortKey: string;
  activatedUsers: number;
  activeUsers: number;
  sessions: number;
  averageSessionMinutes: number;
  retentionD1Percent: number;
  retentionD7Percent: number;
  conversionPercent: number;
  errorRatePercent: number;
  averageFeedbackScore: number;
  criticalFeedback: number;
  economyStabilityScore: number;
  healthScore: number;
  recommendation: BetaRecommendation;
  computedAt: string;
}>;

export type BetaLearningReportView = Readonly<{
  id: string;
  reportKey: string;
  waveId: string;
  waveKey: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  recommendation: BetaRecommendation;
  summary: string;
  findings: unknown;
  metrics: unknown;
  publishedAt: string | null;
}>;

function iso(value: unknown): string | null {
  return value ? new Date(String(value)).toISOString() : null;
}

function dateOnly(value: Date | string): string {
  return new Date(value).toISOString().slice(0,10);
}

export class BetaTelemetryService extends BetaCommunityService {
  async recordEvent(input: {
    userId: string;
    eventKey: string;
    eventType:
      | "session-start" | "session-end" | "feature-used"
      | "task-completed" | "error" | "performance" | "conversion";
    sessionId?: string | undefined;
    durationMs?: number | undefined;
    numericValue?: number | undefined;
    metadata?: unknown;
    occurredAt: string;
  }): Promise<void> {
    const occurredAt = new Date(input.occurredAt).getTime();
    const now = Date.now();
    if (!Number.isFinite(occurredAt)
      || occurredAt < now - 7 * 86_400_000
      || occurredAt > now + 300_000) {
      throw new Error("Data do evento fora da janela permitida.");
    }
    const metadata = JSON.stringify(input.metadata ?? {});
    if (Buffer.byteLength(metadata,"utf8") > 16_000) {
      throw new Error("Metadados de telemetria excedem 16 KB.");
    }
    const waves = await this.sql`
      SELECT member.wave_id
      FROM beta_wave_members member
      JOIN beta_rollout_waves wave ON wave.id=member.wave_id
      WHERE member.user_id=${input.userId}::uuid
        AND member.status IN ('active','completed','paused')
        AND wave.status IN ('active','completed','paused')
      ORDER BY wave.activated_at DESC NULLS LAST,wave.created_at DESC
      LIMIT 1
    `;
    await this.sql`
      INSERT INTO beta_telemetry_events (
        id,event_key,user_id,wave_id,event_type,session_id,duration_ms,
        numeric_value,metadata,occurred_at
      ) VALUES (
        ${randomUUID()}::uuid,${`${input.userId}:${input.eventKey}`},
        ${input.userId}::uuid,
        ${waves[0]?.wave_id ? String(waves[0].wave_id) : null}::uuid,
        ${input.eventType},${input.sessionId ?? null}::uuid,
        ${input.durationMs ?? null},${input.numericValue ?? null},
        ${metadata}::jsonb,${input.occurredAt}
      )
      ON CONFLICT (event_key) DO NOTHING
    `;
  }

  async recomputeDailyMetrics(
    actorId: string,
    targetDate = new Date()
  ): Promise<number> {
    const metricDate = dateOnly(targetDate);
    const waves = await this.sql`
      SELECT id,wave_key FROM beta_rollout_waves
      WHERE status IN ('active','completed','paused','rolled-back') ORDER BY created_at
    `;
    for (const wave of waves) {
      await this.computeWaveMetric(
        actorId,
        String(wave.id),
        String(wave.wave_key),
        metricDate
      );
    }
    return waves.length;
  }

  async generateLearningReport(input: {
    actorId: string;
    waveId: string;
    periodStart: string;
    periodEnd: string;
    summary: string;
    findings: unknown;
    idempotencyKey: string;
  }): Promise<BetaLearningReportView> {
    return this.idempotent(
      `beta-learning-report:${input.idempotencyKey}`,
      input.actorId,
      input,
      async (tx) => {
        const metrics = await tx`
          SELECT * FROM beta_daily_metrics
          WHERE wave_id=${input.waveId}::uuid
            AND metric_date BETWEEN ${input.periodStart}::date AND ${input.periodEnd}::date
          ORDER BY metric_date
        `;
        if (!metrics.length) throw new Error("Não existem métricas para o período.");
        const latest = metrics[metrics.length-1];
        const recommendation = String(
          latest?.recommendation ?? "hold"
        ) as BetaRecommendation;
        const id = randomUUID();
        const key = `LEARN-${new Date().getUTCFullYear()}-${id.slice(0,8).toUpperCase()}`;
        const rows = await tx`
          INSERT INTO beta_learning_reports (
            id,report_key,wave_id,period_start,period_end,recommendation,
            summary,findings,metrics,created_by
          ) VALUES (
            ${id}::uuid,${key},${input.waveId}::uuid,
            ${input.periodStart}::date,${input.periodEnd}::date,${recommendation},
            ${input.summary.slice(0,8000)},${JSON.stringify(input.findings)}::jsonb,
            ${JSON.stringify(metrics)}::jsonb,${input.actorId}::uuid
          ) RETURNING *
        `;
        const wave = await tx`
          SELECT wave_key FROM beta_rollout_waves WHERE id=${input.waveId}::uuid
        `;
        return this.mapReport(rows[0],String(wave[0]?.wave_key));
      }
    );
  }

  async publishLearningReport(input: {
    actorId: string;
    reportId: string;
  }): Promise<void> {
    const rows = await this.sql`
      UPDATE beta_learning_reports SET
        status='published',published_by=${input.actorId}::uuid,
        published_at=now(),updated_at=now()
      WHERE id=${input.reportId}::uuid AND status='draft'
      RETURNING id
    `;
    if (!rows[0]) throw new Error("Relatório não encontrado ou já publicado.");
  }

  async adminState(): Promise<Readonly<{
    readiness: BetaCommunityReadiness;
    metrics: readonly BetaDailyMetricView[];
    feedback: Awaited<ReturnType<BetaCommunityService["feedbackRows"]>>;
    announcements: Awaited<ReturnType<BetaCommunityService["announcementRows"]>>;
    reports: readonly BetaLearningReportView[];
  }>> {
    const [readiness,metrics,feedback,announcements,reports] = await Promise.all([
      this.communityReadiness(),
      this.sql`
        SELECT metric.*,wave.wave_key FROM beta_daily_metrics metric
        JOIN beta_rollout_waves wave ON wave.id=metric.wave_id
        ORDER BY metric.metric_date DESC,metric.computed_at DESC LIMIT 200
      `,
      this.feedbackRows(),
      this.announcementRows(),
      this.sql`
        SELECT report.*,wave.wave_key FROM beta_learning_reports report
        JOIN beta_rollout_waves wave ON wave.id=report.wave_id
        ORDER BY report.period_end DESC,report.created_at DESC LIMIT 100
      `
    ]);
    return {
      readiness,
      metrics: metrics.map((row) => this.mapMetric(row)),
      feedback,
      announcements,
      reports: reports.map((row) => this.mapReport(row,String(row.wave_key)))
    };
  }

  private async computeWaveMetric(
    actorId: string,
    waveId: string,
    waveKey: string,
    metricDate: string
  ): Promise<void> {
    const [members,events,retention,feedback,economy] = await Promise.all([
      this.sql`
        SELECT count(*)::int activated_users FROM beta_wave_members
        WHERE wave_id=${waveId}::uuid
          AND activated_at IS NOT NULL
          AND activated_at<${metricDate}::date+interval '1 day'
      `,
      this.sql`
        SELECT count(DISTINCT user_id)::int active_users,
          count(*) FILTER (WHERE event_type='session-start')::int sessions,
          COALESCE(avg(duration_ms) FILTER (
            WHERE event_type='session-end' AND duration_ms IS NOT NULL
          ),0)::numeric average_duration_ms,
          count(*)::int total_events,
          count(*) FILTER (WHERE event_type='error')::int error_events,
          count(DISTINCT user_id) FILTER (
            WHERE event_type='conversion'
          )::int conversions
        FROM beta_telemetry_events
        WHERE wave_id=${waveId}::uuid
          AND occurred_at>=${metricDate}::date
          AND occurred_at<${metricDate}::date+interval '1 day'
      `,
      this.sql`
        SELECT
          count(*) FILTER (
            WHERE activated_at<${metricDate}::date-interval '1 day'
          )::int eligible_d1,
          count(*) FILTER (
            WHERE activated_at<${metricDate}::date-interval '1 day'
              AND EXISTS (
                SELECT 1 FROM beta_telemetry_events event
                WHERE event.wave_id=member.wave_id AND event.user_id=member.user_id
                  AND event.occurred_at>=member.activated_at+interval '1 day'
                  AND event.occurred_at<member.activated_at+interval '2 days'
              )
          )::int returned_d1,
          count(*) FILTER (
            WHERE activated_at<${metricDate}::date-interval '7 days'
          )::int eligible_d7,
          count(*) FILTER (
            WHERE activated_at<${metricDate}::date-interval '7 days'
              AND EXISTS (
                SELECT 1 FROM beta_telemetry_events event
                WHERE event.wave_id=member.wave_id AND event.user_id=member.user_id
                  AND event.occurred_at>=member.activated_at+interval '7 days'
                  AND event.occurred_at<member.activated_at+interval '8 days'
              )
          )::int returned_d7
        FROM beta_wave_members member
        WHERE member.wave_id=${waveId}::uuid AND member.activated_at IS NOT NULL
      `,
      this.sql`
        SELECT COALESCE(avg(score) FILTER (
            WHERE created_at>=${metricDate}::date-interval '6 days'
              AND created_at<${metricDate}::date+interval '1 day'
          ),0)::numeric average_score,
          count(*) FILTER (
            WHERE priority='critical' AND status IN ('new','reviewing')
          )::int critical_feedback
        FROM beta_feedback WHERE wave_id=${waveId}::uuid
      `,
      this.sql`
        SELECT error_rate_percent,p95_latency_ms,critical_reports
        FROM beta_rollout_observations WHERE wave_id=${waveId}::uuid
        ORDER BY recorded_at DESC LIMIT 1
      `
    ]);

    const activated = Number(members[0]?.activated_users ?? 0);
    const active = Number(events[0]?.active_users ?? 0);
    const totalEvents = Number(events[0]?.total_events ?? 0);
    const errors = Number(events[0]?.error_events ?? 0);
    const eligibleD1 = Number(retention[0]?.eligible_d1 ?? 0);
    const eligibleD7 = Number(retention[0]?.eligible_d7 ?? 0);
    const errorRate = totalEvents ? errors/totalEvents*100 : 0;
    const conversion = activated
      ? Number(events[0]?.conversions ?? 0)/activated*100
      : 0;
    const retentionD1 = eligibleD1
      ? Number(retention[0]?.returned_d1 ?? 0)/eligibleD1*100
      : 0;
    const retentionD7 = eligibleD7
      ? Number(retention[0]?.returned_d7 ?? 0)/eligibleD7*100
      : 0;
    const observation = economy[0];
    const economyScore = observation
      ? Math.max(0,100
        - Number(observation.error_rate_percent ?? 0)*15
        - Number(observation.critical_reports ?? 0)*30
        - Math.max(0,Number(observation.p95_latency_ms ?? 0)-1200)/20)
      : 100;
    const health = calculateBetaHealth({
      activatedUsers: activated,
      activeUsers: active,
      retentionD1Percent: retentionD1,
      retentionD7Percent: retentionD7,
      retentionD1EligibleUsers: eligibleD1,
      retentionD7EligibleUsers: eligibleD7,
      conversionPercent: conversion,
      errorRatePercent: errorRate,
      averageFeedbackScore: Number(feedback[0]?.average_score ?? 0),
      criticalFeedback: Number(feedback[0]?.critical_feedback ?? 0),
      economyStabilityScore: economyScore
    });

    await this.sql`
      INSERT INTO beta_daily_metrics (
        metric_date,wave_id,cohort_key,activated_users,active_users,sessions,
        average_session_minutes,retention_d1_percent,retention_d7_percent,
        conversion_percent,error_rate_percent,average_feedback_score,
        critical_feedback,economy_stability_score,health_score,recommendation,
        evidence,computed_at
      ) VALUES (
        ${metricDate}::date,${waveId}::uuid,${`${waveKey}:all`},
        ${activated},${active},${Number(events[0]?.sessions ?? 0)},
        ${Number(events[0]?.average_duration_ms ?? 0)/60000},
        ${retentionD1},${retentionD7},${conversion},${errorRate},
        ${Number(feedback[0]?.average_score ?? 0)},
        ${Number(feedback[0]?.critical_feedback ?? 0)},${economyScore},
        ${health.healthScore},${health.recommendation},
        ${JSON.stringify({
          computedBy: actorId,reasons: health.reasons,sampleReady: health.sampleReady,
          eligibleD1,eligibleD7
        })}::jsonb,now()
      )
      ON CONFLICT (metric_date,wave_id,cohort_key) DO UPDATE SET
        activated_users=excluded.activated_users,active_users=excluded.active_users,
        sessions=excluded.sessions,average_session_minutes=excluded.average_session_minutes,
        retention_d1_percent=excluded.retention_d1_percent,
        retention_d7_percent=excluded.retention_d7_percent,
        conversion_percent=excluded.conversion_percent,
        error_rate_percent=excluded.error_rate_percent,
        average_feedback_score=excluded.average_feedback_score,
        critical_feedback=excluded.critical_feedback,
        economy_stability_score=excluded.economy_stability_score,
        health_score=excluded.health_score,recommendation=excluded.recommendation,
        evidence=excluded.evidence,computed_at=now()
    `;
  }

  private mapMetric(row: Record<string,unknown>): BetaDailyMetricView {
    return {
      metricDate: String(row.metric_date),waveId: String(row.wave_id),
      waveKey: String(row.wave_key),cohortKey: String(row.cohort_key),
      activatedUsers: Number(row.activated_users),activeUsers: Number(row.active_users),
      sessions: Number(row.sessions),
      averageSessionMinutes: Number(row.average_session_minutes),
      retentionD1Percent: Number(row.retention_d1_percent),
      retentionD7Percent: Number(row.retention_d7_percent),
      conversionPercent: Number(row.conversion_percent),
      errorRatePercent: Number(row.error_rate_percent),
      averageFeedbackScore: Number(row.average_feedback_score),
      criticalFeedback: Number(row.critical_feedback),
      economyStabilityScore: Number(row.economy_stability_score),
      healthScore: Number(row.health_score),
      recommendation: String(row.recommendation) as BetaRecommendation,
      computedAt: new Date(String(row.computed_at)).toISOString()
    };
  }

  private mapReport(
    row: Record<string,unknown> | undefined,
    waveKey: string
  ): BetaLearningReportView {
    if (!row) throw new Error("Relatório não pôde ser criado.");
    return {
      id: String(row.id),reportKey: String(row.report_key),waveId: String(row.wave_id),
      waveKey,periodStart: String(row.period_start),periodEnd: String(row.period_end),
      status: String(row.status),
      recommendation: String(row.recommendation) as BetaRecommendation,
      summary: String(row.summary),findings: row.findings,metrics: row.metrics,
      publishedAt: iso(row.published_at)
    };
  }
}
