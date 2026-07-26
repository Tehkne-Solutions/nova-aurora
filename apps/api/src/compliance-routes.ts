import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  EconomyIntegrityService,
  PrivacyComplianceService
} from "@nova-aurora/database";
import { requireIdentity, requireRole } from "./auth-context.js";

const privacy = new PrivacyComplianceService();
const integrity = new EconomyIntegrityService();

const consentSchema = z.object({
  purpose: z.enum([
    "terms",
    "privacy",
    "essential-processing",
    "analytics",
    "marketing",
    "blockchain-research"
  ]),
  version: z.string().min(1).max(40),
  status: z.enum(["granted", "denied", "withdrawn"])
});

const deletionSchema = z.object({
  reason: z.string().max(500).optional()
});

const changeRequestSchema = z.object({
  itemCode: z.string().min(1).max(64),
  changeType: z.enum([
    "limits",
    "pause",
    "resume",
    "reset-reference",
    "asset-classification"
  ]),
  payload: z.record(z.string(), z.unknown()),
  reason: z.string().min(8).max(1000)
});

const riskReviewSchema = z.object({
  status: z.enum(["normal", "monitored", "restricted", "frozen"]),
  score: z.number().int().min(0).max(1000),
  reason: z.string().min(8).max(1000)
});

const fraudResolveSchema = z.object({
  status: z.enum(["resolved", "false-positive"])
});

const legalHoldSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().min(8).max(1000),
  expiresAt: z.string().datetime().optional()
});

export async function registerComplianceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/compliance/state", async (request) => {
    const identity = await requireIdentity(app, request);
    const [privacyState, integrityState] = await Promise.all([
      privacy.state(identity.userId),
      integrity.state(identity.userId, false)
    ]);
    return {
      privacy: privacyState,
      integrity: integrityState,
      assetNotice: {
        defaultClassification: "Ativos virtuais internos de jogo",
        externalTransferEnabled: false,
        statement: "Nenhum ativo interno representa automaticamente NFT, valor mobiliário ou direito financeiro externo."
      },
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/compliance/consents", async (request) => {
    const identity = await requireIdentity(app, request);
    const body = consentSchema.parse(request.body);
    return {
      privacy: await privacy.setConsent({ identity, ...body }),
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/compliance/export", async (request) => {
    const identity = await requireIdentity(app, request);
    return {
      ...(await privacy.requestExport(identity)),
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/compliance/deletion", async (request) => {
    const identity = await requireIdentity(app, request);
    const body = deletionSchema.parse(request.body ?? {});
    return {
      ...(await privacy.scheduleDeletion({ identity, ...body })),
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/compliance/deletion/cancel", async (request) => {
    const identity = await requireIdentity(app, request);
    return {
      privacy: await privacy.cancelDeletion(identity),
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/integrity/state", async (request) => {
    const identity = await requireRole(app, request, ["platform-admin", "municipal-admin"]);
    return {
      integrity: await integrity.state(identity.userId, true),
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/integrity/changes", async (request) => {
    const identity = await requireRole(app, request, ["platform-admin"]);
    const body = changeRequestSchema.parse(request.body);
    return {
      requestId: await integrity.proposeChange({ actorId: identity.userId, ...body }),
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { requestId: string } }>(
    "/v1/integrity/changes/:requestId/approve",
    async (request, reply) => {
      const identity = await requireRole(app, request, ["platform-admin"]);
      await integrity.approveChange({
        actorId: identity.userId,
        requestId: request.params.requestId
      });
      return reply.status(204).send();
    }
  );

  app.post<{ Params: { userId: string } }>(
    "/v1/integrity/users/:userId/review",
    async (request, reply) => {
      const identity = await requireRole(app, request, ["platform-admin"]);
      const body = riskReviewSchema.parse(request.body);
      await integrity.reviewUser({
        actorId: identity.userId,
        userId: request.params.userId,
        ...body
      });
      return reply.status(204).send();
    }
  );

  app.post<{ Params: { eventId: string } }>(
    "/v1/integrity/fraud-events/:eventId/resolve",
    async (request, reply) => {
      const identity = await requireRole(app, request, ["platform-admin"]);
      const body = fraudResolveSchema.parse(request.body);
      await integrity.resolveFraudEvent({
        actorId: identity.userId,
        eventId: request.params.eventId,
        ...body
      });
      return reply.status(204).send();
    }
  );

  app.post("/v1/compliance/legal-holds", async (request) => {
    const identity = await requireRole(app, request, ["platform-admin"]);
    const body = legalHoldSchema.parse(request.body);
    return {
      holdId: await privacy.createLegalHold({ actorId: identity.userId, ...body }),
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { holdId: string } }>(
    "/v1/compliance/legal-holds/:holdId/release",
    async (request, reply) => {
      const identity = await requireRole(app, request, ["platform-admin"]);
      await privacy.releaseLegalHold({
        actorId: identity.userId,
        holdId: request.params.holdId
      });
      return reply.status(204).send();
    }
  );
}
