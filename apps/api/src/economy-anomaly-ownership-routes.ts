import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireRole } from "./auth-context.js";
import { registerCreatorPlayerEconomyRoutes } from "./creator-player-economy-routes.js";
import { registerCreatorPlayerEconomyAppealRoutes } from "./creator-player-economy-appeal-routes.js";
import { registerCreatorPlayerEconomyDiscoveryRoutes } from "./creator-player-economy-discovery-routes.js";
import { registerCreatorPlayerEconomyModerationRoutes } from "./creator-player-economy-moderation-routes.js";
import { registerCreatorPlayerEconomySettlementRoutes } from "./creator-player-economy-settlement-routes.js";
import { registerCreatorSocialCommentRoutes } from "./creator-social-comment-routes.js";
import { registerEconomyAnomalyOperationsDashboardRoutes } from "./economy-anomaly-operations-dashboard-routes.js";
import { registerEconomyAnomalyOwnerWorkloadRoutes } from "./economy-anomaly-owner-workload-routes.js";
import { registerEconomyAnomalyRebalancingRoutes } from "./economy-anomaly-rebalancing-routes.js";

const economySql=db();
const historyQuery=z.object({limit:z.coerce.number().int().min(1).max(200).default(30),offset:z.coerce.number().int().min(0).default(0)});
const ownershipReason=z.object({reason:z.string().trim().min(10).max(1000)});
const assignmentSchema=ownershipReason.extend({userId:z.string().uuid()});

function ownershipView(row:Record<string,unknown>){
  return {
    anomalyId:String(row.id),
    assignedTo:row.assigned_to?String(row.assigned_to):null,
    assignedAt:row.assigned_at?new Date(String(row.assigned_at)).toISOString():null,
    assignedBy:row.assigned_by?String(row.assigned_by):null,
    acknowledgedAt:row.acknowledged_at?new Date(String(row.acknowledged_at)).toISOString():null,
    acknowledgedBy:row.acknowledged_by?String(row.acknowledged_by):null
  };
}

export async function registerEconomyAnomalyOwnershipRoutes(app:FastifyInstance):Promise<void>{
  await registerCreatorPlayerEconomyRoutes(app);
  await registerCreatorPlayerEconomySettlementRoutes(app);
  await registerCreatorPlayerEconomyDiscoveryRoutes(app);
  await registerCreatorPlayerEconomyModerationRoutes(app);
  await registerCreatorPlayerEconomyAppealRoutes(app);
  await registerCreatorSocialCommentRoutes(app);
  await registerEconomyAnomalyOperationsDashboardRoutes(app);
  await registerEconomyAnomalyOwnerWorkloadRoutes(app);
  await registerEconomyAnomalyRebalancingRoutes(app);

  app.get<{Params:{anomalyId:string}}>('/v1/admin/economy/anomalies/:anomalyId/ownership',async(request)=>{
    await requireRole(app,request,['platform-admin','municipal-admin']);
    const anomalyId=z.string().uuid().parse(request.params.anomalyId);
    const rows=await economySql`SELECT id,assigned_to,assigned_at,assigned_by,acknowledged_at,acknowledged_by FROM economy_snapshot_anomalies WHERE id=${anomalyId}::uuid`;
    if(!rows[0])throw app.httpErrors.notFound('Anomalia econômica não encontrada.');
    return {ownership:ownershipView(rows[0]),signature:'Tehkné Solutions'};
  });

  app.get<{Params:{anomalyId:string}}>('/v1/admin/economy/anomalies/:anomalyId/ownership-history',async(request)=>{
    await requireRole(app,request,['platform-admin','municipal-admin']);
    const anomalyId=z.string().uuid().parse(request.params.anomalyId);
    const query=historyQuery.parse(request.query);
    const rows=await economySql`SELECT * FROM economy_anomaly_ownership_events WHERE anomaly_id=${anomalyId}::uuid ORDER BY occurred_at DESC,id DESC LIMIT ${query.limit} OFFSET ${query.offset}`;
    return {events:rows.map((row)=>({id:String(row.id),anomalyId:String(row.anomaly_id),eventType:String(row.event_type),actorUserId:String(row.actor_user_id),subjectUserId:row.subject_user_id?String(row.subject_user_id):null,reason:String(row.reason),occurredAt:new Date(String(row.occurred_at)).toISOString()})),pagination:query,signature:'Tehkné Solutions'};
  });

  app.post<{Params:{anomalyId:string}}>('/v1/admin/economy/anomalies/:anomalyId/assign',async(request)=>{
    const identity=await requireRole(app,request,['platform-admin']);
    const anomalyId=z.string().uuid().parse(request.params.anomalyId);
    const body=assignmentSchema.parse(request.body);
    const ownership=await economySql.begin('isolation level serializable',async(tx)=>{
      const current=(await tx`SELECT * FROM economy_snapshot_anomalies WHERE id=${anomalyId}::uuid FOR UPDATE`)[0];
      if(!current)throw app.httpErrors.notFound('Anomalia econômica não encontrada.');
      if(current.resolved_at)throw app.httpErrors.conflict('Não é possível atribuir uma anomalia resolvida.');
      if(String(current.assigned_to??'')===body.userId)return ownershipView(current);
      const eventType=current.assigned_to?'reassigned':'assigned';
      const updated=(await tx`UPDATE economy_snapshot_anomalies SET assigned_to=${body.userId}::uuid,assigned_at=now(),assigned_by=${identity.userId}::uuid WHERE id=${anomalyId}::uuid RETURNING *`)[0];
      await tx`INSERT INTO economy_anomaly_ownership_events(id,anomaly_id,event_type,actor_user_id,subject_user_id,reason) VALUES(${randomUUID()}::uuid,${anomalyId}::uuid,${eventType},${identity.userId}::uuid,${body.userId}::uuid,${body.reason})`;
      return ownershipView(updated!);
    });
    return {ownership,signature:'Tehkné Solutions'};
  });

  app.post<{Params:{anomalyId:string}}>('/v1/admin/economy/anomalies/:anomalyId/unassign',async(request)=>{
    const identity=await requireRole(app,request,['platform-admin']);
    const anomalyId=z.string().uuid().parse(request.params.anomalyId);
    const body=ownershipReason.parse(request.body);
    const ownership=await economySql.begin('isolation level serializable',async(tx)=>{
      const current=(await tx`SELECT * FROM economy_snapshot_anomalies WHERE id=${anomalyId}::uuid FOR UPDATE`)[0];
      if(!current)throw app.httpErrors.notFound('Anomalia econômica não encontrada.');
      if(!current.assigned_to)return ownershipView(current);
      const previous=String(current.assigned_to);
      const updated=(await tx`UPDATE economy_snapshot_anomalies SET assigned_to=NULL,assigned_at=NULL,assigned_by=NULL WHERE id=${anomalyId}::uuid RETURNING *`)[0];
      await tx`INSERT INTO economy_anomaly_ownership_events(id,anomaly_id,event_type,actor_user_id,subject_user_id,reason) VALUES(${randomUUID()}::uuid,${anomalyId}::uuid,'unassigned',${identity.userId}::uuid,${previous}::uuid,${body.reason})`;
      return ownershipView(updated!);
    });
    return {ownership,signature:'Tehkné Solutions'};
  });

  app.post<{Params:{anomalyId:string}}>('/v1/admin/economy/anomalies/:anomalyId/acknowledge',async(request)=>{
    const identity=await requireRole(app,request,['platform-admin','municipal-admin']);
    const anomalyId=z.string().uuid().parse(request.params.anomalyId);
    const body=ownershipReason.parse(request.body);
    const ownership=await economySql.begin('isolation level serializable',async(tx)=>{
      const current=(await tx`SELECT * FROM economy_snapshot_anomalies WHERE id=${anomalyId}::uuid FOR UPDATE`)[0];
      if(!current)throw app.httpErrors.notFound('Anomalia econômica não encontrada.');
      if(current.acknowledged_at)return ownershipView(current);
      const updated=(await tx`UPDATE economy_snapshot_anomalies SET acknowledged_at=now(),acknowledged_by=${identity.userId}::uuid WHERE id=${anomalyId}::uuid RETURNING *`)[0];
      await tx`INSERT INTO economy_anomaly_ownership_events(id,anomaly_id,event_type,actor_user_id,subject_user_id,reason) VALUES(${randomUUID()}::uuid,${anomalyId}::uuid,'acknowledged',${identity.userId}::uuid,${identity.userId}::uuid,${body.reason})`;
      return ownershipView(updated!);
    });
    return {ownership,signature:'Tehkné Solutions'};
  });
}

// Tehkné Solutions