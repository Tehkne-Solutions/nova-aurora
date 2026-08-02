import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireRole } from "./auth-context.js";
import { registerEconomyAnomalyRebalanceExecutionRoutes } from "./economy-anomaly-rebalance-execution-routes.js";

const economySql=db();
const querySchema=z.object({
  limit:z.coerce.number().int().min(1).max(100).default(25),
  horizonMinutes:z.coerce.number().int().min(15).max(1440).default(120)
});

function n(value:unknown):number{return Number(value??0);}

export async function registerEconomyAnomalyRebalancingRoutes(app:FastifyInstance):Promise<void>{
  await registerEconomyAnomalyRebalanceExecutionRoutes(app);

  app.get('/v1/admin/economy/anomalies/rebalance-recommendations',async(request)=>{
    await requireRole(app,request,['platform-admin','municipal-admin']);
    const query=querySchema.parse(request.query);
    const rows=await economySql`
      WITH open_items AS (
        SELECT anomaly.*,
          CASE anomaly.severity WHEN 'critical' THEN 60 WHEN 'warning' THEN 240 ELSE 1440 END::int sla_target_minutes,
          extract(epoch FROM (now()-anomaly.detected_at))/60.0 age_minutes
        FROM economy_snapshot_anomalies anomaly
        WHERE anomaly.resolved_at IS NULL
      ), owner_stats AS (
        SELECT assigned_to owner_id,
          count(*)::int open_count,
          count(*) FILTER(WHERE severity='critical')::int critical_count,
          count(*) FILTER(WHERE age_minutes>sla_target_minutes)::int breached_count,
          count(*) FILTER(WHERE acknowledged_at IS NULL)::int unacknowledged_count,
          sum(
            CASE severity WHEN 'critical' THEN 300 WHEN 'warning' THEN 200 ELSE 100 END
            +CASE WHEN age_minutes>sla_target_minutes THEN 150 ELSE 0 END
            +CASE WHEN acknowledged_at IS NULL THEN 50 ELSE 0 END
          )::int workload_score
        FROM open_items
        WHERE assigned_to IS NOT NULL
        GROUP BY assigned_to
      ), ranked_targets AS (
        SELECT owner_id,open_count,workload_score,
          row_number() OVER(ORDER BY workload_score ASC,open_count ASC,owner_id ASC) target_rank
        FROM owner_stats
      ), candidates AS (
        SELECT item.*,
          stats.workload_score source_workload_score,
          stats.open_count source_open_count,
          CASE
            WHEN item.assigned_to IS NULL THEN 500
            WHEN item.severity='critical' AND item.age_minutes>item.sla_target_minutes THEN 450
            WHEN item.age_minutes>item.sla_target_minutes THEN 350
            WHEN item.age_minutes+${query.horizonMinutes}>=item.sla_target_minutes THEN 250
            ELSE 100
          END
          +CASE WHEN item.acknowledged_at IS NULL THEN 50 ELSE 0 END candidate_score
        FROM open_items item
        LEFT JOIN owner_stats stats ON stats.owner_id=item.assigned_to
        WHERE item.assigned_to IS NULL
          OR coalesce(stats.workload_score,0)>=700
          OR item.age_minutes>item.sla_target_minutes
          OR item.age_minutes+${query.horizonMinutes}>=item.sla_target_minutes
      )
      SELECT candidate.*,
        target.owner_id suggested_owner_id,
        target.workload_score suggested_owner_workload_score,
        target.open_count suggested_owner_open_count
      FROM candidates candidate
      LEFT JOIN LATERAL (
        SELECT * FROM ranked_targets target
        WHERE candidate.assigned_to IS NULL OR target.owner_id<>candidate.assigned_to
        ORDER BY target.target_rank
        LIMIT 1
      ) target ON true
      ORDER BY candidate_score DESC,candidate.detected_at ASC,candidate.id ASC
      LIMIT ${query.limit}
    `;

    const recommendations=rows.map((row)=>{
      const age=n(row.age_minutes);
      const target=n(row.sla_target_minutes);
      const remaining=Math.max(target-age,0);
      const breached=age>target;
      const sourceOwner=row.assigned_to?String(row.assigned_to):null;
      const suggestedOwner=row.suggested_owner_id?String(row.suggested_owner_id):null;
      return {
        anomalyId:String(row.id),
        severity:String(row.severity),
        detectedAt:new Date(String(row.detected_at)).toISOString(),
        currentOwnerId:sourceOwner,
        suggestedOwnerId:suggestedOwner,
        acknowledged:row.acknowledged_at!==null,
        ageMinutes:age,
        slaTargetMinutes:target,
        minutesUntilSla:remaining,
        slaBreached:breached,
        sourceWorkloadScore:n(row.source_workload_score),
        sourceOpenCount:n(row.source_open_count),
        suggestedOwnerWorkloadScore:row.suggested_owner_id?n(row.suggested_owner_workload_score):null,
        suggestedOwnerOpenCount:row.suggested_owner_id?n(row.suggested_owner_open_count):null,
        recommendation:suggestedOwner
          ?sourceOwner?'rebalance_owner':'assign_owner'
          :sourceOwner?'escalate_capacity':'assign_or_escalate',
        candidateScore:n(row.candidate_score)
      };
    });

    const summary={
      recommendations:recommendations.length,
      unassigned:recommendations.filter((item)=>item.currentOwnerId===null).length,
      breached:recommendations.filter((item)=>item.slaBreached).length,
      dueWithinHorizon:recommendations.filter((item)=>!item.slaBreached&&item.minutesUntilSla<=query.horizonMinutes).length,
      reassignable:recommendations.filter((item)=>item.suggestedOwnerId!==null).length,
      capacityEscalations:recommendations.filter((item)=>item.suggestedOwnerId===null).length
    };

    return {summary,recommendations,filters:query,generatedAt:new Date().toISOString(),signature:'Tehkné Solutions'};
  });
}

// Tehkné Solutions
