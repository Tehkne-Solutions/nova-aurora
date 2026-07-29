import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireRole } from "./auth-context.js";

const economySql=db();
const booleanQuery=z.enum(["true","false"]).transform((value)=>value==="true");
const dashboardQuery=z.object({
  severity:z.enum(["info","warning","critical"]).optional(),
  assignedTo:z.string().uuid().optional(),
  unassignedOnly:booleanQuery.default(false),
  unacknowledgedOnly:booleanQuery.default(false),
  breachedOnly:booleanQuery.default(false),
  limit:z.coerce.number().int().min(1).max(200).default(30),
  offset:z.coerce.number().int().min(0).default(0)
});

function numberValue(value:unknown):number{return Number(value??0);}
function dateValue(value:unknown):string|null{return value?new Date(String(value)).toISOString():null;}

export async function registerEconomyAnomalyOperationsDashboardRoutes(app:FastifyInstance):Promise<void>{
  app.get("/v1/admin/economy/anomalies/operational-queue",async(request)=>{
    await requireRole(app,request,["platform-admin","municipal-admin"]);
    const query=dashboardQuery.parse(request.query);
    const severity=query.severity??null;
    const assignedTo=query.assignedTo??null;
    const [summaryRows,itemRows]=await Promise.all([
      economySql`
        WITH open_items AS (
          SELECT anomaly.*,
            CASE anomaly.severity WHEN 'critical' THEN 60 WHEN 'warning' THEN 240 ELSE 1440 END::int sla_target_minutes,
            extract(epoch FROM (now()-anomaly.detected_at))/60.0 age_minutes
          FROM economy_snapshot_anomalies anomaly
          WHERE anomaly.resolved_at IS NULL
        )
        SELECT count(*)::int total_open,
          count(*) FILTER(WHERE assigned_to IS NULL)::int unassigned,
          count(*) FILTER(WHERE acknowledged_at IS NULL)::int unacknowledged,
          count(*) FILTER(WHERE age_minutes>sla_target_minutes)::int breached,
          count(*) FILTER(WHERE severity='critical')::int critical_open,
          count(*) FILTER(WHERE severity='critical' AND assigned_to IS NULL)::int critical_unassigned,
          count(*) FILTER(WHERE age_minutes>sla_target_minutes AND acknowledged_at IS NULL)::int breached_unacknowledged
        FROM open_items
      `,
      economySql`
        WITH ranked AS (
          SELECT anomaly.*,
            CASE anomaly.severity WHEN 'critical' THEN 60 WHEN 'warning' THEN 240 ELSE 1440 END::int sla_target_minutes,
            extract(epoch FROM (now()-anomaly.detected_at))/60.0 age_minutes,
            (SELECT count(*)::int FROM economy_anomaly_actions action WHERE action.anomaly_id=anomaly.id AND action.action='reopened') reopen_count
          FROM economy_snapshot_anomalies anomaly
          WHERE anomaly.resolved_at IS NULL
            AND (${severity}::text IS NULL OR anomaly.severity=${severity})
            AND (${assignedTo}::uuid IS NULL OR anomaly.assigned_to=${assignedTo}::uuid)
            AND (${query.unassignedOnly}::boolean=false OR anomaly.assigned_to IS NULL)
            AND (${query.unacknowledgedOnly}::boolean=false OR anomaly.acknowledged_at IS NULL)
        )
        SELECT *,age_minutes>sla_target_minutes AS sla_breached,
          greatest(age_minutes-sla_target_minutes,0) breach_minutes,
          CASE severity WHEN 'critical' THEN 300 WHEN 'warning' THEN 200 ELSE 100 END
            +least(floor(age_minutes/30),100)::int
            +least(reopen_count*20,100)::int
            +CASE WHEN age_minutes>sla_target_minutes THEN 150 ELSE 0 END
            +CASE WHEN assigned_to IS NULL THEN 40 ELSE 0 END
            +CASE WHEN acknowledged_at IS NULL THEN 25 ELSE 0 END AS operational_score
        FROM ranked
        WHERE (${query.breachedOnly}::boolean=false OR age_minutes>sla_target_minutes)
        ORDER BY operational_score DESC,detected_at ASC,id ASC
        LIMIT ${query.limit} OFFSET ${query.offset}
      `
    ]);
    const summary=summaryRows[0]??{};
    const items=itemRows.map((row)=>({
      id:String(row.id),snapshotId:String(row.snapshot_id),anomalyKey:String(row.anomaly_key),severity:String(row.severity),metricKey:String(row.metric_key),
      detectedAt:dateValue(row.detected_at),ageMinutes:numberValue(row.age_minutes),slaTargetMinutes:numberValue(row.sla_target_minutes),slaBreached:Boolean(row.sla_breached),breachMinutes:numberValue(row.breach_minutes),
      reopenCount:numberValue(row.reopen_count),operationalScore:numberValue(row.operational_score),assignedTo:row.assigned_to?String(row.assigned_to):null,assignedAt:dateValue(row.assigned_at),assignedBy:row.assigned_by?String(row.assigned_by):null,
      acknowledgedAt:dateValue(row.acknowledged_at),acknowledgedBy:row.acknowledged_by?String(row.acknowledged_by):null,
      ownershipStatus:row.assigned_to?"assigned":"unassigned",acknowledgementStatus:row.acknowledged_at?"acknowledged":"pending",
      recommendedAction:row.sla_breached?"resolve_or_escalate":!row.assigned_to?"assign_owner":!row.acknowledged_at?"acknowledge":"monitor",evidence:row.evidence
    }));
    return {
      summary:{
        totalOpen:numberValue(summary.total_open),unassigned:numberValue(summary.unassigned),unacknowledged:numberValue(summary.unacknowledged),breached:numberValue(summary.breached),
        criticalOpen:numberValue(summary.critical_open),criticalUnassigned:numberValue(summary.critical_unassigned),breachedUnacknowledged:numberValue(summary.breached_unacknowledged)
      },
      items,pagination:{limit:query.limit,offset:query.offset},filters:{severity:query.severity??null,assignedTo:query.assignedTo??null,unassignedOnly:query.unassignedOnly,unacknowledgedOnly:query.unacknowledgedOnly,breachedOnly:query.breachedOnly},
      generatedAt:new Date().toISOString(),signature:"Tehkné Solutions"
    };
  });
}

// Tehkné Solutions