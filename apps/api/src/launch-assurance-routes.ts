import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { LaunchAssuranceService } from "@nova-aurora/database";
import {
  requireIdentity,
  requireRole,
  requestUserAgent
} from "./auth-context.js";

const assurance = new LaunchAssuranceService();

function idempotencyKey(app: FastifyInstance, request: FastifyRequest): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value.length < 8) {
    throw app.httpErrors.badRequest("Idempotency-Key obrigatório.");
  }
  return value;
}

async function optionalReporterId(
  app: FastifyInstance,
  request: FastifyRequest
): Promise<string | undefined> {
  if (!request.headers.authorization) return undefined;
  try {
    return (await requireIdentity(app, request)).userId;
  } catch {
    return undefined;
  }
}

const reportSchema = z.object({
  category: z.enum([
    "minor-safety",
    "harassment",
    "fraud",
    "security",
    "privacy",
    "content",
    "abuse",
    "other"
  ]),
  subjectType: z.enum(["user", "company", "listing", "message", "event", "system", "other"]),
  subjectReference: z.string().max(240).optional(),
  summary: z.string().min(8).max(500),
  details: z.string().min(16).max(8000),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const guardianRequestSchema = z.object({
  guardianEmail: z.string().email().max(254),
  relationship: z.string().min(3).max(80)
});

const guardianDecisionSchema = z.object({
  token: z.string().min(32).max(200),
  decision: z.enum(["approved", "rejected"]),
  guardianName: z.string().min(3).max(120),
  statementAccepted: z.literal(true)
});

const reportUpdateSchema = z.object({
  status: z.enum(["open", "triaged", "investigating", "actioned", "closed", "dismissed"]),
  priority: z.enum(["low", "normal", "high", "critical"]),
  note: z.string().min(3).max(4000),
  actionCode: z.string().max(120).optional()
});

const exerciseSchema = z.object({
  scenario: z.string().min(8).max(240),
  scheduledAt: z.string().datetime(),
  objectives: z.unknown()
});

const exerciseCompletionSchema = z.object({
  status: z.enum(["passed", "failed"]),
  findings: z.unknown(),
  evidence: z.unknown(),
  actions: z.array(z.object({
    title: z.string().min(3).max(300),
    ownerId: z.string().uuid().optional(),
    dueAt: z.string().datetime().optional()
  })).max(100)
});

const rehearsalSchema = z.object({
  rehearsalType: z.enum(["public-beta-open", "rollback", "provider-delivery", "backup-restore"]),
  environment: z.string().min(2).max(80),
  commitSha: z.string().regex(/^[a-f0-9]{7,64}$/).optional(),
  checklist: z.unknown()
});

const rehearsalCompletionSchema = z.object({
  status: z.enum(["passed", "failed"]),
  evidence: z.unknown(),
  notes: z.string().max(4000).optional()
});

const componentSchema = z.object({
  status: z.enum(["operational", "degraded", "partial-outage", "major-outage", "maintenance"]),
  message: z.string().max(1000).optional()
});

export async function registerLaunchAssuranceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/status/public", async () => assurance.publicStatus());

  app.post("/v1/trust/reports", async (request) => {
    const body = reportSchema.parse(request.body);
    return {
      ...(await assurance.submitReport({
        submissionKey: idempotencyKey(app, request),
        reporterUserId: await optionalReporterId(app, request),
        ...body,
        metadata: {
          ...(body.metadata ?? {}),
          ipHashRecorded: Boolean(request.ip),
          userAgentHashRecorded: Boolean(requestUserAgent(request))
        }
      })),
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/trust/guardian/decision", async (request) => {
    const body = guardianDecisionSchema.parse(request.body);
    return {
      ...(await assurance.guardianDecision({
        ...body,
        ipAddress: request.ip,
        userAgent: requestUserAgent(request)
      })),
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/trust/guardian/request", async (request) => {
    const identity = await requireIdentity(app, request);
    const body = guardianRequestSchema.parse(request.body);
    return {
      ...(await assurance.requestGuardianConsent({
        identity,
        ...body,
        idempotencyKey: idempotencyKey(app, request)
      })),
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/launch-operations/state", async (request) => {
    await requireRole(app, request, ["platform-admin", "municipal-admin"]);
    return {
      ...(await assurance.operationsState()),
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { reportId: string } }>(
    "/v1/launch-operations/reports/:reportId",
    async (request, reply) => {
      const identity = await requireRole(app, request, ["platform-admin", "municipal-admin"]);
      const body = reportUpdateSchema.parse(request.body);
      await assurance.updateReport({
        actorId: identity.userId,
        reportId: request.params.reportId,
        ...body
      });
      return reply.status(204).send();
    }
  );

  app.post("/v1/launch-operations/exercises", async (request) => {
    const identity = await requireRole(app, request, ["platform-admin"]);
    const body = exerciseSchema.parse(request.body);
    return {
      exercise: await assurance.createExercise({
        actorId: identity.userId,
        ...body,
        idempotencyKey: idempotencyKey(app, request)
      }),
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { exerciseId: string } }>(
    "/v1/launch-operations/exercises/:exerciseId/complete",
    async (request, reply) => {
      const identity = await requireRole(app, request, ["platform-admin"]);
      const body = exerciseCompletionSchema.parse(request.body);
      await assurance.completeExercise({
        actorId: identity.userId,
        exerciseId: request.params.exerciseId,
        status: body.status,
        findings: body.findings,
        evidence: body.evidence,
        actions: body.actions.map((action) => ({
          title: action.title,
          ...(action.ownerId === undefined ? {} : { ownerId: action.ownerId }),
          ...(action.dueAt === undefined ? {} : { dueAt: action.dueAt })
        }))
      });
      return reply.status(204).send();
    }
  );

  app.post("/v1/launch-operations/rehearsals", async (request) => {
    const identity = await requireRole(app, request, ["platform-admin"]);
    const body = rehearsalSchema.parse(request.body);
    return {
      rehearsal: await assurance.createRehearsal({
        actorId: identity.userId,
        ...body,
        idempotencyKey: idempotencyKey(app, request)
      }),
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { rehearsalId: string } }>(
    "/v1/launch-operations/rehearsals/:rehearsalId/complete",
    async (request, reply) => {
      const identity = await requireRole(app, request, ["platform-admin"]);
      const body = rehearsalCompletionSchema.parse(request.body);
      await assurance.completeRehearsal({
        actorId: identity.userId,
        rehearsalId: request.params.rehearsalId,
        ...body
      });
      return reply.status(204).send();
    }
  );

  app.post<{ Params: { componentKey: string } }>(
    "/v1/launch-operations/components/:componentKey",
    async (request, reply) => {
      const identity = await requireRole(app, request, ["platform-admin"]);
      const body = componentSchema.parse(request.body);
      await assurance.updateComponent({
        actorId: identity.userId,
        componentKey: request.params.componentKey,
        ...body
      });
      return reply.status(204).send();
    }
  );
}
