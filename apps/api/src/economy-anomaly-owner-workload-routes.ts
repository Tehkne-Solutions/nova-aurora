import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireRole } from "./auth-context.js";

const economySql=db();
const workloadQuery=z.object({
  limit:z.coerce.number().int().min(1).max(100).default(50),
  includeUnassigned:z.enum(["true","false"]).transform((value)=>value==="true").default(true),
  horizonMinutes:z.coerce.number().int().min(15).max(1440).default(120)
});

function n(value:unknown):number{return Number(value??0);}
function nullable(value:unknown):number|null{return value===null||value===undefined?null:Number(value);}

export async function registerEconomyAnomalyOwnerWorkloadRoutes(app:FastifyInstance):Promise<void>{
  app.get("/v1/admin/economy/anomalies/owner-workload",async(request)=>{
    await requireRole(app,request,["platform-admin","municipal-admin"]);
    const query=workloadQuery.parse(request.query);
    const horizon=query.horizonMinutes;

    const [ownerRows,summaryRows]=await Promise.all([
      economySql`
        WITH open_anomalies AS (
          SELECT anomaly.*,
            CASE anomaly.severity WHEN 'critical' THEN 60 WHEN 'warning' THEN 240 ELSE 1440 END::int sla_target_minutes,
            extract(epoch FROM (now()-anomaly.detected_at))/60.0 age_minutes
          FROM economy_snapshot_anomalies anomaly
          WHERE anomaly.resolved_at IS NULL
        )
        SELECT assigned_to,
          count(*)::int open_count,
          count(*) FILTER(WHERE severity='critical')::int critical_count,
          count(*) FILTER(WHERE acknowledged_at IS NULL)::int unacknowledged_count,
          count(*) FILTER(WHERE age_minutes>sla_target_minutes)::int breached_count,
          count(*) FILTER(WHERE age_minutes<=sla_target_minutes AND sla_target_minutes-age_minutes<=${horizon})::int at_risk_count,
          avg(age_minutes) average_age_minutes,
          max(age_minutes) oldest_age_minutes,
          sum(CASE severity WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 ELSE 1 END)::int severity_weight,
          sum(CASE WHEN age_minutes>sla_target_minutes THEN 3 WHEN sla_target_minutes-age_minutes<=${horizon} THEN 2 ELSE 0 END)::int sla_risk_weight
        FROM open_anomalies
        WHERE (${query.includeUnassigned}::boolean=true OR assigned_to IS NOT NULL)
        GROUP BY assigned_to
        ORDER BY (sum(CASE severity WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 ELSE 1 END)+sum(CASE WHEN age_minutes>sla_target_minutes THEN 3 WHEN sla_target_minutes-age_minutes<=${horizon} THEN 2 ELSE 0 END)) DESC,
          count(*) DESC,
          assigned_to NULLS LAST
        LIMIT ${query.limit}
      `,
      economySql`
        WITH open_anomalies AS (
          SELECT anomaly.*,
            CASE anomaly.severity WHEN 'critical' THEN 60 WHEN 'warning' THEN 240 ELSE 1440 END::int sla_target_minutes,
            extract(epoch FROM (now()-anomaly.detected_at))/60.0 age_minutes
          FROM economy_snapshot_anomalies anomaly
          WHERE anomaly.resolved_at IS NULL
        )
        SELECT count(*)::int total_open,
          count(*) FILTER(WHERE assigned_to IS NULL)::int unassigned,
          count(*) FILTER(WHERE assigned_to IS NOT NULL)::int assigned,
          count(*) FILTER(WHERE acknowledged_at IS NULL)::int unacknowledged,
          count(*) FILTER(WHERE age_minutes>sla_target_minutes)::int breached,
          count(*) FILTER(WHERE age_minutes<=sla_target_minutes AND sla_target_minutes-age_minutes<=${horizon})::int at_risk,
          count(DISTINCT assigned_to) FILTER(WHERE assigned_to IS NOT NULL)::int active_owners
        FROM open_anomalies
      `
    ]);

    const owners=ownerRows.map((row)=>{
      const openCount=n(row.open_count);
      const criticalCount=n(row.critical_count);
      const breachedCount=n(row.breached_count);
      const atRiskCount=n(row.at_risk_count);
      const unacknowledgedCount=n(row.unacknowledged_count);
      const severityWeight=n(row.severity_weight);
      const slaRiskWeight=n(row.sla_risk_weight);
      const workloadScore=severityWeight+slaRiskWeight+unacknowledgedCount;
      const riskLevel=breachedCount>0&&criticalCount>0?"critical":breachedCount>0||atRiskCount>=3?"high":atRiskCount>0||criticalCount>0?"moderate":"normal";
      return {
        ownerUserId:row.assigned_to?String(row.assigned_to):null,
        isUnassigned:row.assigned_to===null,
        openCount,criticalCount,unacknowledgedCount,breachedCount,atRiskCount,
        averageAgeMinutes:nullable(row.average_age_minutes),
        oldestAgeMinutes:nullable(row.oldest_age_minutes),
        workloadScore,riskLevel,
        utilizationSignal:openCount>=10||workloadScore>=30?"overloaded":openCount>=5||workloadScore>=15?"busy":"normal"
      };
    });

    const summary=summaryRows[0]??{};
    return {
      horizonMinutes:horizon,
      summary:{
        totalOpen:n(summary.total_open),assigned:n(summary.assigned),unassigned:n(summary.unassigned),
        unacknowledged:n(summary.unacknowledged),breached:n(summary.breached),atRisk:n(summary.at_risk),activeOwners:n(summary.active_owners)
      },
      owners,
      generatedAt:new Date().toISOString(),
      signature:"Tehkné Solutions"
    };
  });
}

// Tehkné Solutions
