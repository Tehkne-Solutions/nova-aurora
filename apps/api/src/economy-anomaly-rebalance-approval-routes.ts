import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireRole } from "./auth-context.js";

const economySql=db();
const recommendation=z.enum(["assign_owner","rebalance_owner","assign_or_escalate","escalate_capacity"]);
const requestSchema=z.object({recommendation,requestedOwnerId:z.string().uuid().nullable().optional(),reason:z.string().trim().min(10).max(1000)});
const decisionSchema=z.object({reason:z.string().trim().min(10).max(1000)});

export function approvalRequired(severity:string,recommendationValue:string):boolean{
  return severity==="critical"||recommendationValue==="rebalance_owner"||recommendationValue==="escalate_capacity";
}

export async function validateRebalanceApproval(tx:any,input:{approvalId?:string|null;anomalyId:string;recommendation:string;nextOwnerId:string|null;severity:string;actorUserId:string}){
  if(!approvalRequired(input.severity,input.recommendation))return null;
  if(!input.approvalId)throw new Error("approvalId obrigatório para rebalanceamento sensível.");
  const approval=(await tx`SELECT * FROM economy_anomaly_rebalance_approvals WHERE id=${input.approvalId}::uuid FOR UPDATE`)[0];
  if(!approval)throw new Error("Aprovação não encontrada.");
  if(String(approval.anomaly_id)!==input.anomalyId)throw new Error("Aprovação pertence a outra anomalia.");
  if(String(approval.recommendation)!==input.recommendation)throw new Error("Aprovação não corresponde à recomendação executada.");
  const requestedOwner=approval.requested_owner_id?String(approval.requested_owner_id):null;
  if(requestedOwner!==input.nextOwnerId)throw new Error("Aprovação não corresponde ao responsável solicitado.");
  if(String(approval.status)!=="approved")throw new Error("Aprovação ainda não está válida para execução.");
  if(String(approval.requested_by)===input.actorUserId&&String(approval.decided_by)===input.actorUserId)throw new Error("Solicitante não pode autoaprovar e executar a mesma ação sensível.");
  return approval;
}

export async function registerEconomyAnomalyRebalanceApprovalRoutes(app:FastifyInstance):Promise<void>{
  app.post<{Params:{anomalyId:string}}>("/v1/admin/economy/anomalies/:anomalyId/rebalance-approval-request",async(request)=>{
    const identity=await requireRole(app,request,["platform-admin"]);
    const anomalyId=z.string().uuid().parse(request.params.anomalyId);
    const body=requestSchema.parse(request.body);
    const rows=await economySql`SELECT id,severity,resolved_at FROM economy_snapshot_anomalies WHERE id=${anomalyId}::uuid`;
    const anomaly=rows[0];
    if(!anomaly)throw app.httpErrors.notFound("Anomalia econômica não encontrada.");
    if(anomaly.resolved_at)throw app.httpErrors.conflict("Não é possível solicitar aprovação para anomalia resolvida.");
    if(!approvalRequired(String(anomaly.severity),body.recommendation))throw app.httpErrors.badRequest("Esta ação não exige aprovação em duas etapas.");
    if(body.recommendation!=="escalate_capacity"&&!body.requestedOwnerId)throw app.httpErrors.badRequest("requestedOwnerId é obrigatório para esta recomendação.");
    if(body.recommendation==="escalate_capacity"&&body.requestedOwnerId)throw app.httpErrors.badRequest("requestedOwnerId deve ser omitido em escalonamento de capacidade.");
    const id=randomUUID();
    const approval=(await economySql`INSERT INTO economy_anomaly_rebalance_approvals(id,anomaly_id,recommendation,requested_owner_id,requested_by,request_reason) VALUES(${id}::uuid,${anomalyId}::uuid,${body.recommendation},${body.requestedOwnerId??null}::uuid,${identity.userId}::uuid,${body.reason}) RETURNING *`)[0];
    return {approval,signature:"Tehkné Solutions"};
  });

  app.post<{Params:{approvalId:string}}>("/v1/admin/economy/rebalance-approvals/:approvalId/approve",async(request)=>{
    const identity=await requireRole(app,request,["platform-admin"]);
    const approvalId=z.string().uuid().parse(request.params.approvalId);
    const body=decisionSchema.parse(request.body);
    const approval=await economySql.begin("isolation level serializable",async(tx)=>{
      const current=(await tx`SELECT * FROM economy_anomaly_rebalance_approvals WHERE id=${approvalId}::uuid FOR UPDATE`)[0];
      if(!current)throw app.httpErrors.notFound("Aprovação não encontrada.");
      if(String(current.status)!=="pending")return current;
      if(String(current.requested_by)===identity.userId)throw app.httpErrors.conflict("Solicitante não pode aprovar a própria solicitação.");
      return (await tx`UPDATE economy_anomaly_rebalance_approvals SET status='approved',decided_by=${identity.userId}::uuid,decision_reason=${body.reason},decided_at=now() WHERE id=${approvalId}::uuid RETURNING *`)[0];
    });
    return {approval,signature:"Tehkné Solutions"};
  });

  app.post<{Params:{approvalId:string}}>("/v1/admin/economy/rebalance-approvals/:approvalId/reject",async(request)=>{
    const identity=await requireRole(app,request,["platform-admin"]);
    const approvalId=z.string().uuid().parse(request.params.approvalId);
    const body=decisionSchema.parse(request.body);
    const approval=await economySql.begin("isolation level serializable",async(tx)=>{
      const current=(await tx`SELECT * FROM economy_anomaly_rebalance_approvals WHERE id=${approvalId}::uuid FOR UPDATE`)[0];
      if(!current)throw app.httpErrors.notFound("Aprovação não encontrada.");
      if(String(current.status)!=="pending")return current;
      return (await tx`UPDATE economy_anomaly_rebalance_approvals SET status='rejected',decided_by=${identity.userId}::uuid,decision_reason=${body.reason},decided_at=now() WHERE id=${approvalId}::uuid RETURNING *`)[0];
    });
    return {approval,signature:"Tehkné Solutions"};
  });

  app.get("/v1/admin/economy/rebalance-approvals",async(request)=>{
    await requireRole(app,request,["platform-admin","municipal-admin"]);
    const rows=await economySql`SELECT * FROM economy_anomaly_rebalance_approvals ORDER BY requested_at DESC,id DESC LIMIT 100`;
    return {approvals:rows,signature:"Tehkné Solutions"};
  });
}

// Tehkné Solutions
