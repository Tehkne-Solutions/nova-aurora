import { EconomyRepositoryBase } from "./economy-base.js";

export type EconomyAnomalySeverityCounts=Readonly<{
  info:number;
  warning:number;
  critical:number;
}>;

export type EconomyAnomalyMetrics=Readonly<{
  total:number;
  open:number;
  resolved:number;
  resolutionRatePercent:number;
  reopenedActions:number;
  averageResolutionMinutes:number|null;
  oldestOpenAgeMinutes:number|null;
  bySeverity:EconomyAnomalySeverityCounts;
  openBySeverity:EconomyAnomalySeverityCounts;
}>;

function numberValue(value:unknown):number{return Number(value??0);}
function nullableNumber(value:unknown):number|null{return value===null||value===undefined?null:Number(value);}

export class EconomyAnomalyMetricsService extends EconomyRepositoryBase {
  async current():Promise<EconomyAnomalyMetrics>{
    const [summaryRows,severityRows,reopenRows]=await Promise.all([
      this.sql`SELECT count(*)::int total,count(*) FILTER(WHERE resolved_at IS NULL)::int open_count,count(*) FILTER(WHERE resolved_at IS NOT NULL)::int resolved_count,avg(extract(epoch FROM (resolved_at-detected_at))/60.0) FILTER(WHERE resolved_at IS NOT NULL) average_resolution_minutes,max(extract(epoch FROM (now()-detected_at))/60.0) FILTER(WHERE resolved_at IS NULL) oldest_open_age_minutes FROM economy_snapshot_anomalies`,
      this.sql`SELECT severity,count(*)::int total,count(*) FILTER(WHERE resolved_at IS NULL)::int open_count FROM economy_snapshot_anomalies GROUP BY severity`,
      this.sql`SELECT count(*)::int reopened_actions FROM economy_anomaly_actions WHERE action='reopened'`
    ]);
    const summary=summaryRows[0]??{};
    const total=numberValue(summary.total);
    const resolved=numberValue(summary.resolved_count);
    const bySeverity={info:0,warning:0,critical:0};
    const openBySeverity={info:0,warning:0,critical:0};
    for(const row of severityRows){
      const severity=String(row.severity) as keyof EconomyAnomalySeverityCounts;
      if(severity in bySeverity){
        bySeverity[severity]=numberValue(row.total);
        openBySeverity[severity]=numberValue(row.open_count);
      }
    }
    return {
      total,
      open:numberValue(summary.open_count),
      resolved,
      resolutionRatePercent:total===0?0:Number(((resolved/total)*100).toFixed(2)),
      reopenedActions:numberValue(reopenRows[0]?.reopened_actions),
      averageResolutionMinutes:nullableNumber(summary.average_resolution_minutes),
      oldestOpenAgeMinutes:nullableNumber(summary.oldest_open_age_minutes),
      bySeverity,
      openBySeverity
    };
  }
}

// Tehkné Solutions
