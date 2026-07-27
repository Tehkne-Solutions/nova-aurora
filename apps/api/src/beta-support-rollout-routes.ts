import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { BetaSupportRolloutService } from "@nova-aurora/database";
import { requireIdentity, requireRole } from "./auth-context.js";

const operations = new BetaSupportRolloutService();

function idempotencyKey(app: FastifyInstance,request: FastifyRequest): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value.length < 8 || value.length > 160) {
    throw app.httpErrors.badRequest("Idempotency-Key obrigatório.");
  }
  return value;
}

const ticketSchema = z.object({
  category: z.enum([
    "account","technical","gameplay","economy","safety","privacy","other"
  ]),
  priority: z.enum(["low","normal","high","critical"]).default("normal"),
  subject: z.string().min(3).max(240),
  details: z.string().min(10).max(12000)
});

const ticketUpdateSchema = z.object({
  status: z.enum([
    "open","acknowledged","in-progress","waiting-user","resolved","closed"
  ]),
  priority: z.enum(["low","normal","high","critical"]),
  message: z.string().min(3).max(8000),
  visibleToUser: z.boolean().default(true),
  assignedTo: z.string().uuid().optional()
});

const flagSchema = z.object({
  flagKey: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,79}$/),
  label: z.string().min(3).max(160),
  description: z.string().min(10).max(4000),
  defaultVariant: z.string().min(1).max(80),
  variants: z.array(z.string().min(1).max(80)).min(1).max(10),
  rolloutPercent: z.number().int().min(0).max(100),
  targetWaveIds: z.array(z.string().uuid()).max(100).default([]),
  safetyThresholds: z.unknown().optional()
});

const approvalSchema = z.object({
  decision: z.enum(["approve","reject"]),
  note: z.string().min(3).max(4000)
});

const pauseSchema = z.object({ reason: z.string().min(3).max(1000) });

export async function registerBetaSupportRolloutRoutes(
  app: FastifyInstance
): Promise<void> {
  app.post("/v1/beta-support/tickets",async (request) => {
    const identity = await requireIdentity(app,request);
    const body = ticketSchema.parse(request.body);
    return {
      ticket: await operations.createTicket({
        userId: identity.userId,
        idempotencyKey: idempotencyKey(app,request),
        ...body
      }),
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/beta-support/tickets",async (request) => {
    const identity = await requireIdentity(app,request);
    return {
      tickets: await operations.ticketsForUser(identity.userId),
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/beta-support/admin/state",async (request) => {
    await requireRole(app,request,["platform-admin","municipal-admin"]);
    return { ...(await operations.adminState()),signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { ticketId: string } }>(
    "/v1/beta-support/admin/tickets/:ticketId",
    async (request,reply) => {
      const identity = await requireRole(
        app,request,["platform-admin","municipal-admin"]
      );
      const body = ticketUpdateSchema.parse(request.body);
      await operations.updateTicket({
        actorId: identity.userId,
        ticketId: request.params.ticketId,
        status: body.status,
        priority: body.priority,
        message: body.message,
        visibleToUser: body.visibleToUser,
        ...(body.assignedTo === undefined ? {} : { assignedTo: body.assignedTo })
      });
      return reply.status(204).send();
    }
  );

  app.post("/v1/feature-flags",async (request) => {
    const identity = await requireRole(app,request,["platform-admin"]);
    const body = flagSchema.parse(request.body);
    return {
      flag: await operations.createFlag({
        actorId: identity.userId,
        idempotencyKey: idempotencyKey(app,request),
        ...body
      }),
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { flagId: string } }>(
    "/v1/feature-flags/:flagId/approvals",
    async (request,reply) => {
      const identity = await requireRole(app,request,["platform-admin"]);
      const body = approvalSchema.parse(request.body);
      await operations.recordFlagApproval({
        actorId: identity.userId,
        flagId: request.params.flagId,
        ...body
      });
      return reply.status(204).send();
    }
  );

  app.post<{ Params: { flagId: string } }>(
    "/v1/feature-flags/:flagId/activate",
    async (request,reply) => {
      const identity = await requireRole(app,request,["platform-admin"]);
      await operations.activateFlag({
        actorId: identity.userId,
        flagId: request.params.flagId
      });
      return reply.status(204).send();
    }
  );

  app.post<{ Params: { flagId: string } }>(
    "/v1/feature-flags/:flagId/pause",
    async (request,reply) => {
      const identity = await requireRole(app,request,["platform-admin"]);
      const body = pauseSchema.parse(request.body);
      await operations.pauseFlag({
        actorId: identity.userId,
        flagId: request.params.flagId,
        reason: body.reason
      });
      return reply.status(204).send();
    }
  );

  app.get<{ Params: { flagKey: string } }>(
    "/v1/feature-flags/:flagKey/evaluate",
    async (request) => {
      const identity = await requireIdentity(app,request);
      return {
        evaluation: await operations.evaluateFlag({
          userId: identity.userId,
          flagKey: request.params.flagKey
        }),
        signature: "Tehkné Solutions"
      };
    }
  );
}
