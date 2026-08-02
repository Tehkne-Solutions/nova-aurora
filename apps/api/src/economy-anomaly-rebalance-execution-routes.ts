import { randomUUID } from "node:crypto";
import type { FastifyInstance,FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireRole } from "./auth-context.js";

const economySql=db();
const executionSchema=z.object({
  recommendation:z.enum(["assign_owner","rebalance_owner","assign_or_escalate","escalate_capacity"]),
  nextOwnerId:z.string().uuid().nullable().optional(),
  reason:z.string().trim().min(10).max(1000)
});

function idempotencyKey(request:FastifyRequest):string{
  const value=request.headers["idempotency-key"];
  if(typeof value!=="string"||value.length<8)throw new Error("Idempotency-Key obrigatório.");
  return value;
}

export async function registerEconomyAnomalyRebalanceExecutionRoutes(app:FastifyInstance):Promise<void>{
  app.post<{Params:{anomalyId:string}}>("/v1/admin/economy/anomalies/:anomalyId/rebalance-execute",async(request)=>{
    const identity=await requireRole(app,request,["platform-admin"]);
    const anomalyId=z.string().uuid().parse(request.params.anomalyId);
    const body=executionSchema.parse(request.body);
    const key=idempotencyKey(request);

    const result=await economySql.begin("isolation level serializable",async(tx)=>{
      const prior=(await tx`SELECT * FROM economy_anomaly_rebalance_executions WHERE actor_user_id=${identity.userId}::uuid AND idempotency_key=${key} LIMIT 1`)[0];
      if(prior){
        const anomaly=(await tx`SELECT * FROM economy_snapshot_anomalies WHERE id=${String(prior.anomaly_id)}::uuid`)[0];
        return {execution:prior,anomaly};
      }

      const current=(await tx`SELECT * FROM economy_snapshot_anomalies WHERE id=${anomalyId}::uuid FOR UPDATE`)[0];
      if(!current)throw app.httpErrors.notFound("Anomalia econômica não encontrada.");
      if(current.resolved_at)throw app.httpErrors.conflict("Não é possível rebalancear uma anomalia resolvida.");

      const previousOwner=current.assigned_to?String(current.assigned_to):null;
      const nextOwner=body.nextOwnerId??null;
      if(body.recommendation!=="escalate_capacity"&&!nextOwner)throw app.httpErrors.badRequest("nextOwnerId é obrigatório para esta recomendação.");
      if(body.recommendation==="escalate_capacity"&&nextOwner)throw app.httpErrors.badRequest("nextOwnerId deve ser omitido em escalonamento de capacidade.");

      let updated=current;
      if(nextOwner&&nextOwner!==previousOwner){
        updated=(await tx`UPDATE economy_snapshot_anomalies SET assigned_to=${nextOwner}::uuid,assigned_at=now(),assigned_by=${identity.userId}::uuid WHERE id=${anomalyId}::uuid RETURNING *`)[0]??current;
        const eventType=previousOwner?"reassigned":"assigned";
        await tx`INSERT INTO economy_anomaly_ownership_events(id,anomaly_id,event_type,actor_user_id,subject_user_id,reason) VALUES(${randomUUID()}::uuid,${anomalyId}::uuid,${eventType},${identity.userId}::uuid,${nextOwner}::uuid,${body.reason})`;
      }

      const executionId=randomUUID();
      const execution=(await tx`INSERT INTO economy_anomaly_rebalance_executions(id,anomaly_id,previous_owner_id,next_owner_id,recommendation,actor_user_id,reason,idempotency_key) VALUES(${executionId}::uuid,${anomalyId}::uuid,${previousOwner}::uuid,${nextOwner}::uuid,${body.recommendation},${identity.userId}::uuid,${body.reason},${key}) RETURNING *`)[0];
      return {execution,anomaly:updated};
    });

    return {
      execution:{id:String(result.execution!.id),anomalyId:String(result.execution!.anomaly_id),previousOwnerId:result.execution!.previous_owner_id?String(result.execution!.previous_owner_id):null,nextOwnerId:result.execution!.next_owner_id?String(result.execution!.next_owner_id):null,recommendation:String(result.execution!.recommendation),actorUserId:String(result.execution!.actor_user_id),reason:String(result.execution!.reason),executedAt:new Date(String(result.execution!.executed_at)).toISOString()},
      ownership:{assignedTo:result.anomaly?.assigned_to?String(result.anomaly.assigned_to):null,assignedAt:result.anomaly?.assigned_at?new Date(String(result.anomaly.assigned_at)).toISOString():null,assignedBy:result.anomaly?.assigned_by?String(result.anomaly.assigned_by):null},
      signature:"Tehkné Solutions"
    };
  });

  app.get<{Params:{anomalyId:string}}>("/v1/admin/economy/anomalies/:anomalyId/rebalance-history",async(request)=>{
    await requireRole(app,request,["platform-admin","municipal-admin"]);
    const anomalyId=z.string().uuid().parse(request.params.anomalyId);
    const rows=await economySql`SELECT * FROM economy_anomaly_rebalance_executions WHERE anomaly_id=${anomalyId}::uuid ORDER BY executed_at DESC,id DESC LIMIT 100`;
    return {executions:rows.map((row)=>({id:String(row.id),previousOwnerId:row.previous_owner_id?String(row.previous_owner_id):null,nextOwnerId:row.next_owner_id?String(row.next_owner_id):null,recommendation:String(row.recommendation),actorUserId:String(row.actor_user_id),reason:String(row.reason),executedAt:new Date(String(row.executed_at)).toISOString()})),signature:"Tehkné Solutions"};
  });
}

// Tehkné Solutions
