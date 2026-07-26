import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { LaunchAssuranceService } from "@nova-aurora/database";
import {
  requireIdentity,
  requireRole,
  requestUserAgent
} from "./auth-context.js";

const trust = new LaunchAssuranceService();

function idempotencyKey(app: FastifyInstance, request: FastifyRequest): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value.length < 8) {
    throw app.httpErrors.badRequest("Idempotency-Key obrigatório.");
  }
  return value;
}

const ageSchema = z.object({
  ageBand: z.enum(["under-14", "14-15", "16-17", "18-plus"]),
  method: z.enum(["self-declaration", "guardian-attestation", "verified-provider"])
});

const acceptanceSchema = z.object({
  documents: z.array(z.object({
    key: z.string().min(2).max(80),
    version: z.string().min(1).max(40)
  })).min(1).max(20)
});

const guardianSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  evidence: z.record(z.string(), z.unknown())
});

const documentSchema = z.object({
  key: z.string().min(2).max(80),
  version: z.string().min(1).max(40),
  title: z.string().min(3).max(200),
  locale: z.string().min(2).max(20).default("pt-BR"),
  audience: z.enum(["all", "minor", "guardian", "adult"]).default("all"),
  requiredForBeta: z.boolean().default(true),
  status: z.enum(["draft", "published", "retired"]),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  publicUrl: z.string().max(1000).optional(),
  externalReviewReference: z.string().max(500).optional(),
  effectiveAt: z.string().datetime().optional()
});

const reviewSchema = z.object({
  reviewType: z.enum([
    "independent-security",
    "privacy-lgpd",
    "terms-consumer",
    "asset-classification",
    "minors-safety",
    "incident-response",
    "taxation"
  ]),
  reviewerName: z.string().min(3).max(200),
  reviewerOrganization: z.string().max(200).optional(),
  status: z.enum(["pending", "in-review", "approved", "changes-required", "expired"]),
  reference: z.string().min(3).max(500),
  reportUrl: z.string().url().max(1000).optional(),
  summary: z.string().max(4000).optional(),
  evidence: z.unknown().optional(),
  publicVisible: z.boolean().default(false),
  reviewedAt: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional()
});

const incidentSchema = z.object({
  category: z.enum(["security", "privacy", "economy", "availability", "abuse", "legal"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  title: z.string().min(3).max(200),
  summary: z.string().min(8).max(4000),
  publicVisible: z.boolean().default(false),
  publicNoticeUrl: z.string().url().max(1000).optional(),
  detectedAt: z.string().datetime()
});

const incidentUpdateSchema = z.object({
  status: z.enum(["open", "contained", "resolved", "postmortem"]),
  note: z.string().min(3).max(4000),
  publicVisible: z.boolean().default(false)
});

export async function registerTrustRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/trust/public", async () => trust.publicState());

  app.get("/v1/trust/state", async (request) => {
    const identity = await requireIdentity(app, request);
    return {
      ...(await trust.userState(identity.userId)),
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/trust/age-assurance", async (request) => {
    const identity = await requireIdentity(app, request);
    const body = ageSchema.parse(request.body);
    return {
      ...(await trust.setAgeAssurance({
        identity,
        ...body,
        idempotencyKey: idempotencyKey(app, request)
      })),
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/trust/acceptances", async (request) => {
    const identity = await requireIdentity(app, request);
    const body = acceptanceSchema.parse(request.body);
    return {
      ...(await trust.acceptDocuments({
        identity,
        documents: body.documents,
        ipAddress: request.ip,
        userAgent: requestUserAgent(request),
        idempotencyKey: idempotencyKey(app, request)
      })),
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/trust/admin/state", async (request) => {
    await requireRole(app, request, ["platform-admin", "municipal-admin"]);
    return {
      ...(await trust.adminState()),
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { userId: string } }>(
    "/v1/trust/guardians/:userId/review",
    async (request, reply) => {
      const identity = await requireRole(app, request, ["platform-admin"]);
      const body = guardianSchema.parse(request.body);
      await trust.reviewGuardian({
        actorId: identity.userId,
        userId: request.params.userId,
        ...body
      });
      return reply.status(204).send();
    }
  );

  app.post("/v1/trust/documents", async (request) => {
    const identity = await requireRole(app, request, ["platform-admin"]);
    const body = documentSchema.parse(request.body);
    return {
      document: await trust.upsertDocument({
        actorId: identity.userId,
        ...body,
        idempotencyKey: idempotencyKey(app, request)
      }),
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/trust/reviews", async (request) => {
    const identity = await requireRole(app, request, ["platform-admin"]);
    const body = reviewSchema.parse(request.body);
    return {
      review: await trust.recordExternalReview({
        actorId: identity.userId,
        ...body,
        idempotencyKey: idempotencyKey(app, request)
      }),
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/trust/incidents", async (request) => {
    const identity = await requireRole(app, request, ["platform-admin"]);
    const body = incidentSchema.parse(request.body);
    return {
      incident: await trust.createIncident({
        actorId: identity.userId,
        ...body,
        idempotencyKey: idempotencyKey(app, request)
      }),
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { incidentId: string } }>(
    "/v1/trust/incidents/:incidentId/updates",
    async (request, reply) => {
      const identity = await requireRole(app, request, ["platform-admin"]);
      const body = incidentUpdateSchema.parse(request.body);
      await trust.updateIncident({
        actorId: identity.userId,
        incidentId: request.params.incidentId,
        ...body
      });
      return reply.status(204).send();
    }
  );
}
