import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BetaDecisionCenterService } from "@nova-aurora/database";
import { requireRole } from "./auth-context.js";

const decisions=new BetaDecisionCenterService();
const decisionSchema=z.object({decision:z.enum(["expand","hold","reduce","stop","reject"]),rationale:z.string().min(10).max(8000),evidence:z.unknown().optional(),resultIds:z.array(z.string().uuid()).max(500).default([])});
const reportSchema=z.object({learning:z.string().min(10).max(12000),futureRecommendations:z.array(z.string().min(3).max(500)).max(50).default([])});

export async function registerBetaDecisionCenterRoutes(app:FastifyInstance):Promise<void>{
  app.get("/v1/beta-decisions/admin/state",async(request)=>{await requireRole(app,request,["platform-admin","municipal-admin"]);return{...await decisions.adminState(),signature:"Tehkné Solutions"};});
  app.post<{Params:{experimentId:string}}>("/v1/beta-decisions/:experimentId",async(request,reply)=>{const identity=await requireRole(app,request,["platform-admin"]);const body=decisionSchema.parse(request.body);await decisions.recordDecision({actorId:identity.userId,experimentId:request.params.experimentId,decision:body.decision,rationale:body.rationale,evidence:body.evidence??{},resultIds:body.resultIds});return reply.status(204).send();});
  app.post<{Params:{experimentId:string}}>("/v1/beta-decisions/:experimentId/final-report",async(request)=>{const identity=await requireRole(app,request,["platform-admin"]);const body=reportSchema.parse(request.body);return{report:await decisions.generateFinalReport({actorId:identity.userId,experimentId:request.params.experimentId,learning:body.learning,futureRecommendations:body.futureRecommendations}),signature:"Tehkné Solutions"};});
}

// Tehkné Solutions
