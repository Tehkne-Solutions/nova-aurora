import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { BetaTelemetryService } from "@nova-aurora/database";
import { requireIdentity, requireRole } from "./auth-context.js";

const telemetry = new BetaTelemetryService();

function idempotencyKey(app: FastifyInstance, request: FastifyRequest): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value.length < 8) {
    throw app.httpErrors.badRequest("Idempotency-Key obrigatório.");
  }
  return value;
}

const eventSchema = z.object({
  eventKey: z.string().min(8).max(160),
  eventType: z.enum([
    "session-start","session-end","feature-used","task-completed",
    "error","performance","conversion"
  ]),
  sessionId: z.string().uuid().optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
  numericValue: z.number().finite().optional(),
  metadata: z.unknown().optional(),
  occurredAt: z.string().datetime()
});

const feedbackSchema = z.object({
  category: z.enum([
    "bug","usability","economy","performance","safety",
    "content","suggestion","other"
  ]),
  sentiment: z.enum(["negative","neutral","positive"]),
  score: z.number().int().min(1).max(5),
  summary: z.string().min(3).max(500),
  details: z.string().min(10).max(8000)
});

const feedbackUpdateSchema = z.object({
  status: z.enum(["new","reviewing","planned","resolved","dismissed"]),
  priority: z.enum(["low","normal","high","critical"]),
  note: z.string().min(3).max(4000),
  assignedTo: z.string().uuid().optional()
});

const announcementSchema = z.object({
  title: z.string().min(3).max(200),
  body: z.string().min(10).max(8000),
  audience: z.enum(["all","beta","wave","admins"]),
  waveId: z.string().uuid().optional(),
  severity: z.enum(["info","success","warning","critical"]),
  publishAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional()
});

const recomputeSchema = z.object({ targetDate: z.string().datetime().optional() });
const reportSchema = z.object({
  waveId: z.string().uuid(),
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  summary: z.string().min(10).max(8000),
  findings: z.unknown()
});

export async function registerBetaTelemetryRoutes(
  app: FastifyInstance
): Promise<void> {
  app.post("/v1/beta/telemetry", async (request, reply) => {
    const identity = await requireIdentity(app, request);
    const body = eventSchema.parse(request.body);
    await telemetry.recordEvent({ userId: identity.userId, ...body });
    return reply.status(202).send({ accepted: true, signature: "Tehkné Solutions" });
  });

  app.post("/v1/beta/feedback", async (request) => {
    const identity = await requireIdentity(app, request);
    const body = feedbackSchema.parse(request.body);
    return {
      ...(await telemetry.submitFeedback({
        userId: identity.userId,
        ...body,
        idempotencyKey: idempotencyKey(app, request)
      })),
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/community/announcements", async (request) => {
    const identity = await requireIdentity(app, request);
    return {
      announcements: await telemetry.announcementsFor(identity.userId),
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { announcementId: string } }>(
    "/v1/community/announcements/:announcementId/read",
    async (request, reply) => {
      const identity = await requireIdentity(app, request);
      await telemetry.markAnnouncementRead({
        userId: identity.userId,
        announcementId: request.params.announcementId
      });
      return reply.status(204).send();
    }
  );

  app.get("/v1/beta-insights/state", async (request) => {
    await requireRole(app, request, ["platform-admin","municipal-admin"]);
    return { ...(await telemetry.adminState()), signature: "Tehkné Solutions" };
  });

  app.post("/v1/beta-insights/recompute", async (request) => {
    const identity = await requireRole(app, request, ["platform-admin"]);
    const body = recomputeSchema.parse(request.body ?? {});
    return {
      computed: await telemetry.recomputeDailyMetrics(
        identity.userId,
        body.targetDate ? new Date(body.targetDate) : new Date()
      ),
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/beta-insights/announcements", async (request) => {
    const identity = await requireRole(app, request, ["platform-admin"]);
    const body = announcementSchema.parse(request.body);
    return {
      announcement: await telemetry.createAnnouncement({
        actorId: identity.userId,
        title: body.title,
        body: body.body,
        audience: body.audience,
        severity: body.severity,
        idempotencyKey: idempotencyKey(app, request),
        ...(body.waveId === undefined ? {} : { waveId: body.waveId }),
        ...(body.publishAt === undefined ? {} : { publishAt: body.publishAt }),
        ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt })
      }),
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { announcementId: string } }>(
    "/v1/beta-insights/announcements/:announcementId/publish",
    async (request, reply) => {
      const identity = await requireRole(app, request, ["platform-admin"]);
      await telemetry.publishAnnouncement({
        actorId: identity.userId,
        announcementId: request.params.announcementId
      });
      return reply.status(204).send();
    }
  );

  app.post<{ Params: { feedbackId: string } }>(
    "/v1/beta-insights/feedback/:feedbackId",
    async (request, reply) => {
      const identity = await requireRole(
        app,
        request,
        ["platform-admin","municipal-admin"]
      );
      const body = feedbackUpdateSchema.parse(request.body);
      await telemetry.updateFeedback({
        actorId: identity.userId,
        feedbackId: request.params.feedbackId,
        status: body.status,
        priority: body.priority,
        note: body.note,
        ...(body.assignedTo === undefined ? {} : { assignedTo: body.assignedTo })
      });
      return reply.status(204).send();
    }
  );

  app.post("/v1/beta-insights/learning-reports", async (request) => {
    const identity = await requireRole(app, request, ["platform-admin"]);
    const body = reportSchema.parse(request.body);
    return {
      report: await telemetry.generateLearningReport({
        actorId: identity.userId,
        ...body,
        idempotencyKey: idempotencyKey(app, request)
      }),
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { reportId: string } }>(
    "/v1/beta-insights/learning-reports/:reportId/publish",
    async (request, reply) => {
      const identity = await requireRole(app, request, ["platform-admin"]);
      await telemetry.publishLearningReport({
        actorId: identity.userId,
        reportId: request.params.reportId
      });
      return reply.status(204).send();
    }
  );
}
