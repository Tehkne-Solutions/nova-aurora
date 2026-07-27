import type { FastifyInstance,FastifyRequest } from "fastify";
import { z } from "zod";
import { BetaExperimentService } from "@nova-aurora/database";
import { requireRole } from "./auth-context.js";

const experiments = new BetaExperimentService();

function idempotencyKey(app:FastifyInstance,request:FastifyRequest): string {
  const value = request.headers["idempotency-key"];
  if (typeof value!=="string" || value.length<8 || value.length>160) {
    throw app.httpErrors.badRequest("Idempotency-Key obrigatório.");
  }
  return value;
}

const guardrailSchema = z.object({
  maxErrorRatePercent:z.number().min(0).max(100),
  maxCriticalFeedback:z.number().int().min(0),
  maxSupportSlaBreaches:z.number().int().min(0),
  minimumEconomyStabilityScore:z.number().min(0).max(100)
});

const experimentSchema = z.object({
  experimentKey:z.string().regex(/^[a-z0-9][a-z0-9._-]{2,79}$/),
  flagId:z.string().uuid(),label:z.string().min(3).max(160),
  hypothesis:z.string().min(10).max(4000),
  decisionQuestion:z.string().min(5).max(1000),
  primaryMetric:z.enum(["conversion","retention-d1","retention-d7","feedback","engagement","economy"]),
  secondaryMetrics:z.array(z.string().min(1).max(80)).max(20).default([]),
  guardrails:guardrailSchema,
  minimumSample:z.number().int().min(10).max(1_000_000),
  minimumRuntimeHours:z.number().int().min(1).max(8760),
  minimumLiftPercent:z.number().min(0).max(1000),
  startsAt:z.string().datetime().optional(),endsAt:z.string().datetime().optional()
});
const approvalSchema = z.object({decision:z.enum(["approve","reject"]),note:z.string().min(3).max(4000)});
const pauseSchema = z.object({reason:z.string().min(3).max(1000)});
const decisionSchema = z.object({
  decision:z.enum(["expand","hold","reduce","stop"]),
  rationale:z.string().min(10).max(8000),
  evidence:z.unknown().optional(),resultIds:z.array(z.string().uuid()).max(500).default([])
});

export async function registerBetaExperimentRoutes(app:FastifyInstance): Promise<void> {
  app.get("/v1/beta-experiments/admin/state",async (request) => {
    await requireRole(app,request,["platform-admin","municipal-admin"]);
    return {...await experiments.adminState(),signature:"Tehkné Solutions"};
  });

  app.post("/v1/beta-experiments",async (request) => {
    const identity = await requireRole(app,request,["platform-admin"]);
    const body = experimentSchema.parse(request.body);
    return {
      experiment:await experiments.createExperiment({
        actorId:identity.userId,idempotencyKey:idempotencyKey(app,request),...body
      }),signature:"Tehkné Solutions"
    };
  });

  app.post<{Params:{experimentId:string}}>(
    "/v1/beta-experiments/:experimentId/approvals",async (request,reply) => {
      const identity = await requireRole(app,request,["platform-admin"]);
      const body = approvalSchema.parse(request.body);
      await experiments.recordApproval({actorId:identity.userId,experimentId:request.params.experimentId,...body});
      return reply.status(204).send();
    }
  );

  app.post<{Params:{experimentId:string}}>(
    "/v1/beta-experiments/:experimentId/start",async (request,reply) => {
      const identity = await requireRole(app,request,["platform-admin"]);
      await experiments.startExperiment({actorId:identity.userId,experimentId:request.params.experimentId});
      return reply.status(204).send();
    }
  );

  app.post<{Params:{experimentId:string}}>(
    "/v1/beta-experiments/:experimentId/pause",async (request,reply) => {
      const identity = await requireRole(app,request,["platform-admin"]);
      const body = pauseSchema.parse(request.body);
      await experiments.pauseExperiment({actorId:identity.userId,experimentId:request.params.experimentId,reason:body.reason});
      return reply.status(204).send();
    }
  );

  app.post<{Params:{experimentId:string}}>(
    "/v1/beta-experiments/:experimentId/decisions",async (request,reply) => {
      const identity = await requireRole(app,request,["platform-admin"]);
      const body = decisionSchema.parse(request.body);
      await experiments.recordDecision({
        actorId:identity.userId,experimentId:request.params.experimentId,
        decision:body.decision,rationale:body.rationale,
        evidence:body.evidence ?? {},resultIds:body.resultIds
      });
      return reply.status(204).send();
    }
  );

  app.post<{Params:{experimentId:string}}>(
    "/v1/beta-experiments/:experimentId/complete",async (request,reply) => {
      const identity = await requireRole(app,request,["platform-admin"]);
      await experiments.completeExperiment({actorId:identity.userId,experimentId:request.params.experimentId});
      return reply.status(204).send();
    }
  );
}

// Tehkné Solutions
