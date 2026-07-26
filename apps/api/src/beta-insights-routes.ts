import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ALLOWED_PRODUCT_EVENTS,
  BetaInsightsService
} from "@nova-aurora/database/beta-insights";
import { requireIdentity, requireRole } from "./auth-context.js";

const insights = new BetaInsightsService();

function idempotencyKey(app: FastifyInstance, request: FastifyRequest): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value.length < 8) {
    throw app.httpErrors.badRequest("Idempotency-Key obrigatório.");
  }
  return value;
}

const eventSchema = z.object({
  clientEventId: z.string().min(8).max(120),
  eventKey: z.enum(ALLOWED_PRODUCT_EVENTS),
  occurredAt: z.string().datetime(),
  route: z.string().max(240).optional(),
  waveId: z.string().uuid().optional(),
  schemaVersion: z.number().int().min(1).max(20).optional(),
  properties: z.record(z.string(), z.unknown()).optional()
});

const feedbackSchema = z.object({
  category: z.enum([
    "gameplay","economy","usability","performance","accessibility","trust","other"
  ]),
  rating: z.number().int().min(1).max(5),
  summary: z.string().min(3).max(500),
  details: z.string().min(8).max(8000)
});

const supportSchema = z.object({
  category: z.enum([
    "account","billing-internal","gameplay","economy","technical","safety","privacy","other"
  ]),
  priority: z.enum(["low","normal","high","critical"]),
  subject: z.string().min(3).max(240),
  details: z.string().min(8).max(8000)
});

const supportUpdateSchema = z.object({
  status: z.enum(["open","acknowledged","in-progress","waiting-user","resolved","closed"]),
  priority: z.enum(["low","normal","high","critical"]),
  message: z.string().min(3).max(8000),
  visibleToUser: z.boolean().default(true),
  assignedTo: z.string().uuid().optional()
});

const flagSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,79}$/),
  label: z.string().min(3).max(160),
  description: z.string().min(8).max(2000),
  defaultVariant: z.string().min(1).max(80),
  variants: z.array(z.string().min(1).max(80)).min(1).max(10),
  rolloutPercent: z.number().int().min(0).max(100),
  targetWaveIds: z.array(z.string().uuid()).max(100).default([]),
  safetyThresholds: z.unknown().default({})
});

const approvalSchema = z.object({
  decision: z.enum(["approve","reject"]),
  note: z.string().min(8).max(2000)
});

const activationSchema = z.object({
  rolloutPercent: z.number().int().min(1).max(100)
});

const pauseSchema = z.object({
  reason: z.string().min(8).max(2000)
});

export async function registerBetaInsightsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/beta-insights/events", async (request) => {
    const identity = await requireIdentity(app, request);
    const body = z.object({ events: z.array(eventSchema).min(1).max(50) }).parse(request.body);
    return {
      ...(await insights.ingestEvents({
        identity,
        events: body.events,
        idempotencyKey: idempotencyKey(app, request)
      })),
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/beta-insights/feedback", async (request) => {
    const identity = await requireIdentity(app, request);
    const body = feedbackSchema.parse(request.body);
    return {
      ...(await insights.submitFeedback({
        identity,
        ...body,
        idempotencyKey: idempotencyKey(app, request)
      })),
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/beta-insights/support", async (request) => {
    const identity = await requireIdentity(app, request);
    const body = supportSchema.parse(request.body);
    return {
      ...(await insights.createSupportTicket({
        identity,
        ...body,
        idempotencyKey: idempotencyKey(app, request)
      })),
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/beta-insights/me", async (request) => {
    const identity = await requireIdentity(app, request);
    return {
      ...(await insights.userState(identity.userId)),
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/beta-insights/admin", async (request) => {
    await requireRole(app, request, ["platform-admin", "municipal-admin"]);
    return {
      ...(await insights.adminState()),
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { ticketId: string } }>(
    "/v1/beta-insights/admin/support/:ticketId",
    async (request, reply) => {
      const identity = await requireRole(app, request, ["platform-admin", "municipal-admin"]);
      const body = supportUpdateSchema.parse(request.body);
      await insights.updateSupportTicket({
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

  app.post("/v1/beta-insights/admin/flags", async (request) => {
    const identity = await requireRole(app, request, ["platform-admin"]);
    const body = flagSchema.parse(request.body);
    return {
      flag: await insights.createFlag({
        actorId: identity.userId,
        ...body,
        idempotencyKey: idempotencyKey(app, request)
      }),
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { flagId: string } }>(
    "/v1/beta-insights/admin/flags/:flagId/approve",
    async (request) => {
      const identity = await requireRole(app, request, ["platform-admin"]);
      const body = approvalSchema.parse(request.body);
      return {
        flag: await insights.approveFlag({
          actorId: identity.userId,
          flagId: request.params.flagId,
          ...body
        }),
        signature: "Tehkné Solutions"
      };
    }
  );

  app.post<{ Params: { flagId: string } }>(
    "/v1/beta-insights/admin/flags/:flagId/activate",
    async (request) => {
      const identity = await requireRole(app, request, ["platform-admin"]);
      const body = activationSchema.parse(request.body);
      return {
        flag: await insights.activateFlag({
          actorId: identity.userId,
          flagId: request.params.flagId,
          rolloutPercent: body.rolloutPercent
        }),
        signature: "Tehkné Solutions"
      };
    }
  );

  app.post<{ Params: { flagId: string } }>(
    "/v1/beta-insights/admin/flags/:flagId/pause",
    async (request) => {
      const identity = await requireRole(app, request, ["platform-admin"]);
      const body = pauseSchema.parse(request.body);
      return {
        flag: await insights.pauseFlag({
          actorId: identity.userId,
          flagId: request.params.flagId,
          reason: body.reason
        }),
        signature: "Tehkné Solutions"
      };
    }
  );

  app.get<{ Params: { flagKey: string } }>(
    "/v1/beta-insights/flags/:flagKey",
    async (request) => {
      const identity = await requireIdentity(app, request);
      return {
        ...(await insights.evaluateFlag({ identity, flagKey: request.params.flagKey })),
        signature: "Tehkné Solutions"
      };
    }
  );

  app.post("/v1/beta-insights/admin/refresh-gates", async (request) => {
    await requireRole(app, request, ["platform-admin"]);
    return {
      readiness: await insights.refreshGates(),
      signature: "Tehkné Solutions"
    };
  });

  app.delete("/v1/beta-insights/admin/expired-events", async (request) => {
    await requireRole(app, request, ["platform-admin"]);
    return {
      deleted: await insights.purgeExpiredTelemetry(),
      signature: "Tehkné Solutions"
    };
  });
}
