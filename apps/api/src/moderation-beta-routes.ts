import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { BetaOperationsService } from "@nova-aurora/database";
import { requireIdentity, requireRole } from "./auth-context.js";

const operations = new BetaOperationsService();

function idempotencyKey(
  app: FastifyInstance,
  request: FastifyRequest
): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value.length < 8) {
    throw app.httpErrors.badRequest("Idempotency-Key obrigatório.");
  }
  return value;
}

const assignmentSchema = z.object({ moderatorId: z.string().uuid() });
const actionSchema = z.object({
  reportId: z.string().uuid().optional(),
  subjectUserId: z.string().uuid().optional(),
  subjectReference: z.string().max(240).optional(),
  actionType: z.enum([
    "warning",
    "restrict-economy",
    "suspend-account",
    "remove-content",
    "no-action"
  ]),
  reason: z.string().min(8).max(4000),
  endsAt: z.string().datetime().optional()
});
const appealSchema = z.object({
  statement: z.string().min(16).max(8000)
});
const appealDecisionSchema = z.object({
  decision: z.enum(["upheld", "denied"]),
  note: z.string().min(8).max(4000)
});
const shiftSchema = z.object({
  moderatorId: z.string().uuid(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  notes: z.string().max(1000).optional()
});
const waveSchema = z.object({
  label: z.string().min(3).max(160),
  targetPercent: z.number().int().min(1).max(100),
  maxActivations: z.number().int().min(1).max(100_000),
  eligibility: z.unknown().default({}),
  thresholds: z.unknown().default({}),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional()
});
const enrollSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(1000)
});
const transitionSchema = z.object({
  reason: z.string().min(8).max(4000),
  killSwitch: z.boolean().optional()
});
const observationSchema = z.object({
  waveId: z.string().uuid().optional(),
  errorRatePercent: z.number().min(0).max(100),
  p95LatencyMs: z.number().int().min(0).max(600_000),
  criticalReports: z.number().int().min(0).max(100_000),
  activeUsers: z.number().int().min(0).max(10_000_000),
  metadata: z.unknown().optional()
});
const killSwitchSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().min(8).max(1000)
});

export async function registerModerationBetaRoutes(
  app: FastifyInstance
): Promise<void> {
  app.get("/v1/moderation/state", async (request) => {
    await requireRole(
      app,
      request,
      ["platform-admin", "municipal-admin"]
    );
    return {
      ...(await operations.moderationState()),
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { reportId: string } }>(
    "/v1/moderation/reports/:reportId/assign",
    async (request, reply) => {
      const identity = await requireRole(
        app,
        request,
        ["platform-admin", "municipal-admin"]
      );
      const body = assignmentSchema.parse(request.body);
      await operations.assignReport({
        actorId: identity.userId,
        reportId: request.params.reportId,
        moderatorId: body.moderatorId
      });
      return reply.status(204).send();
    }
  );

  app.post<{ Params: { reportId: string } }>(
    "/v1/moderation/reports/:reportId/acknowledge",
    async (request, reply) => {
      const identity = await requireRole(
        app,
        request,
        ["platform-admin", "municipal-admin"]
      );
      await operations.acknowledgeReport({
        actorId: identity.userId,
        reportId: request.params.reportId
      });
      return reply.status(204).send();
    }
  );

  app.post("/v1/moderation/actions", async (request) => {
    const identity = await requireRole(
      app,
      request,
      ["platform-admin", "municipal-admin"]
    );
    const body = actionSchema.parse(request.body);
    return {
      action: await operations.applyModerationAction({
        actorId: identity.userId,
        actionType: body.actionType,
        reason: body.reason,
        idempotencyKey: idempotencyKey(app, request),
        ...(body.reportId === undefined
          ? {}
          : { reportId: body.reportId }),
        ...(body.subjectUserId === undefined
          ? {}
          : { subjectUserId: body.subjectUserId }),
        ...(body.subjectReference === undefined
          ? {}
          : { subjectReference: body.subjectReference }),
        ...(body.endsAt === undefined
          ? {}
          : { endsAt: body.endsAt })
      }),
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { actionId: string } }>(
    "/v1/moderation/actions/:actionId/appeals",
    async (request) => {
      const identity = await requireIdentity(app, request);
      const body = appealSchema.parse(request.body);
      return {
        ...(await operations.submitAppeal({
          identity,
          actionId: request.params.actionId,
          statement: body.statement
        })),
        signature: "Tehkné Solutions"
      };
    }
  );

  app.post<{ Params: { appealId: string } }>(
    "/v1/moderation/appeals/:appealId/review",
    async (request, reply) => {
      const identity = await requireRole(
        app,
        request,
        ["platform-admin"]
      );
      const body = appealDecisionSchema.parse(request.body);
      await operations.reviewAppeal({
        actorId: identity.userId,
        appealId: request.params.appealId,
        ...body
      });
      return reply.status(204).send();
    }
  );

  app.post("/v1/moderation/shifts", async (request) => {
    const identity = await requireRole(
      app,
      request,
      ["platform-admin"]
    );
    const body = shiftSchema.parse(request.body);
    return {
      shift: await operations.scheduleModerationShift({
        actorId: identity.userId,
        moderatorId: body.moderatorId,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        ...(body.notes === undefined
          ? {}
          : { notes: body.notes })
      }),
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/beta-control/state", async (request) => {
    await requireRole(
      app,
      request,
      ["platform-admin", "municipal-admin"]
    );
    return {
      ...(await operations.state()),
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/beta-control/my-access", async (request) => {
    const identity = await requireIdentity(app, request);
    return {
      ...(await operations.myAccess(identity.userId)),
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/beta-control/waves", async (request) => {
    const identity = await requireRole(
      app,
      request,
      ["platform-admin"]
    );
    const body = waveSchema.parse(request.body);
    return {
      wave: await operations.createWave({
        actorId: identity.userId,
        label: body.label,
        targetPercent: body.targetPercent,
        maxActivations: body.maxActivations,
        eligibility: body.eligibility,
        thresholds: body.thresholds,
        idempotencyKey: idempotencyKey(app, request),
        ...(body.startsAt === undefined
          ? {}
          : { startsAt: body.startsAt }),
        ...(body.endsAt === undefined
          ? {}
          : { endsAt: body.endsAt })
      }),
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { waveId: string } }>(
    "/v1/beta-control/waves/:waveId/enroll",
    async (request) => {
      const identity = await requireRole(
        app,
        request,
        ["platform-admin"]
      );
      const body = enrollSchema.parse(request.body);
      return {
        ...(await operations.enrollUsers({
          actorId: identity.userId,
          waveId: request.params.waveId,
          userIds: body.userIds
        })),
        signature: "Tehkné Solutions"
      };
    }
  );

  app.post<{ Params: { waveId: string } }>(
    "/v1/beta-control/waves/:waveId/approve",
    async (request, reply) => {
      const identity = await requireRole(
        app,
        request,
        ["platform-admin"]
      );
      const body = transitionSchema.parse(request.body);
      await operations.approveWave({
        actorId: identity.userId,
        waveId: request.params.waveId,
        reason: body.reason
      });
      return reply.status(204).send();
    }
  );

  app.post<{ Params: { waveId: string } }>(
    "/v1/beta-control/waves/:waveId/start",
    async (request, reply) => {
      const identity = await requireRole(
        app,
        request,
        ["platform-admin"]
      );
      const body = transitionSchema.parse(request.body);
      await operations.startWave({
        actorId: identity.userId,
        waveId: request.params.waveId,
        reason: body.reason
      });
      return reply.status(204).send();
    }
  );

  app.post<{ Params: { waveId: string } }>(
    "/v1/beta-control/waves/:waveId/pause",
    async (request, reply) => {
      const identity = await requireRole(
        app,
        request,
        ["platform-admin"]
      );
      const body = transitionSchema.parse(request.body);
      await operations.pauseWave({
        actorId: identity.userId,
        waveId: request.params.waveId,
        reason: body.reason,
        ...(body.killSwitch === undefined
          ? {}
          : { killSwitch: body.killSwitch })
      });
      return reply.status(204).send();
    }
  );

  app.post<{ Params: { waveId: string } }>(
    "/v1/beta-control/waves/:waveId/rollback",
    async (request, reply) => {
      const identity = await requireRole(
        app,
        request,
        ["platform-admin"]
      );
      const body = transitionSchema.parse(request.body);
      await operations.rollbackWave({
        actorId: identity.userId,
        waveId: request.params.waveId,
        reason: body.reason
      });
      return reply.status(204).send();
    }
  );

  app.post<{ Params: { waveId: string } }>(
    "/v1/beta-control/waves/:waveId/complete",
    async (request, reply) => {
      const identity = await requireRole(
        app,
        request,
        ["platform-admin"]
      );
      const body = transitionSchema.parse(request.body);
      await operations.completeWave({
        actorId: identity.userId,
        waveId: request.params.waveId,
        reason: body.reason
      });
      return reply.status(204).send();
    }
  );

  app.post("/v1/beta-control/observations", async (request) => {
    const identity = await requireRole(
      app,
      request,
      ["platform-admin"]
    );
    const body = observationSchema.parse(request.body);
    return {
      ...(await operations.recordObservation({
        actorId: identity.userId,
        errorRatePercent: body.errorRatePercent,
        p95LatencyMs: body.p95LatencyMs,
        criticalReports: body.criticalReports,
        activeUsers: body.activeUsers,
        ...(body.waveId === undefined
          ? {}
          : { waveId: body.waveId }),
        ...(body.metadata === undefined
          ? {}
          : { metadata: body.metadata })
      })),
      signature: "Tehkné Solutions"
    };
  });

  app.post(
    "/v1/beta-control/kill-switch",
    async (request, reply) => {
      const identity = await requireRole(
        app,
        request,
        ["platform-admin"]
      );
      const body = killSwitchSchema.parse(request.body);
      await operations.setKillSwitch({
        actorId: identity.userId,
        enabled: body.enabled,
        reason: body.reason
      });
      return reply.status(204).send();
    }
  );
}
